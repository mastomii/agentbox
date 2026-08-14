// D1 (Cloudflare's serverless SQLite) data layer for the control plane.
//
// Why D1 instead of KV:
//   KV is operation-billed (1,000 writes/lists per day on the free plan) and
//   can't filter/count/sort — every "unread count" or "list messages" meant
//   scanning many keys. D1 is real SQLite: one indexed query does the work,
//   and the free plan allows 5M row reads + 100k row writes per day with NO
//   credit card.
//
// Bootstrap / chicken-egg resolution:
//   - CF_API_TOKEN lives in an env var (the ONE secret outside the DB, since
//     querying D1 via REST needs the token).
//   - The account id is auto-discovered from the token.
//   - The D1 database id is discovered by fixed name ("agentbox") or created.
//   - Everything else (users, api keys, settings, inboxes, mail) lives in D1.
//
// The email Worker writes inbound mail by binding D1 natively (env.DB), so the
// hot path never touches REST. The dashboard (which runs outside Cloudflare)
// reads/writes D1 via the REST query endpoint.

const CF_API = "https://api.cloudflare.com/client/v4";
const DB_NAME = "agentbox";

type CfResp<T> = { success: boolean; errors: { code: number; message: string }[]; result: T };

export function cfToken(): string {
  const t = process.env.CF_API_TOKEN;
  if (!t) throw new Error("CF_API_TOKEN env var is not set");
  return t;
}

export function hasToken(): boolean {
  return !!process.env.CF_API_TOKEN;
}

async function cf<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json()) as CfResp<T>;
  if (!data.success) {
    throw new Error(data.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || "Cloudflare API error");
  }
  return data.result;
}

// --- bootstrap: account id + database id (memoized per process) ---
const cache: { accountId?: string; dbId?: string } = {};

export async function getAccountId(): Promise<string> {
  if (cache.accountId) return cache.accountId;
  const accounts = await cf<{ id: string; name: string }[]>("/accounts?per_page=50");
  if (!accounts.length) throw new Error("Token has no account access");
  cache.accountId = accounts[0].id;
  return cache.accountId;
}

// Find the agentbox D1 database by name; returns null if not provisioned yet.
export async function findDatabaseId(): Promise<string | null> {
  if (cache.dbId) return cache.dbId;
  const acc = await getAccountId();
  const list = await cf<{ uuid: string; name: string }[]>(`/accounts/${acc}/d1/database?per_page=100`);
  const found = list.find((d) => d.name === DB_NAME);
  if (found) cache.dbId = found.uuid;
  return found?.uuid ?? null;
}

export async function ensureDatabaseId(): Promise<string> {
  const existing = await findDatabaseId();
  if (existing) return existing;
  const acc = await getAccountId();
  const created = await cf<{ uuid: string }>(`/accounts/${acc}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name: DB_NAME }),
  });
  cache.dbId = created.uuid;
  await migrate(); // create tables on a fresh database
  return created.uuid;
}

export function clearDbCache() {
  cache.dbId = undefined;
}

async function dbId(): Promise<string | null> {
  return findDatabaseId();
}

// --- query helpers ---
type D1QueryResult<T> = { results: T[]; success: boolean; meta: Record<string, unknown> }[];

// Run a parameterized SQL statement. Returns rows (empty array for writes).
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const id = await dbId();
  if (!id) return [];
  const acc = await getAccountId();
  const res = await cf<D1QueryResult<T>>(`/accounts/${acc}/d1/database/${id}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  });
  return res[0]?.results ?? [];
}

// Run a write/DDL statement; ignores returned rows.
export async function run(sql: string, params: unknown[] = []): Promise<void> {
  await query(sql, params);
}

// Convenience: first row or null.
export async function get<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// --- schema ---
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);
CREATE TABLE IF NOT EXISTS inboxes (
  id              TEXT PRIMARY KEY,
  address         TEXT NOT NULL UNIQUE,
  label           TEXT,
  route_id        TEXT,
  created_at      INTEGER NOT NULL,
  last_message_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inboxes_address ON inboxes(address);
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  from_addr   TEXT,
  from_name   TEXT,
  subject     TEXT,
  text        TEXT,
  html        TEXT,
  preview     TEXT,
  size        INTEGER,
  seen        INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_address ON messages(address, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(address, seen);
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  filename    TEXT,
  content_type TEXT,
  size        INTEGER,
  r2_key      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  count INTEGER NOT NULL
);
`;

// Apply the schema (idempotent). D1's query endpoint runs one statement at a
// time, so split on ';'.
export async function migrate(): Promise<void> {
  const stmts = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await run(s);
  // Additive column migrations for pre-existing databases (CREATE TABLE IF NOT
  // EXISTS won't alter an existing users table). Ignore "duplicate column".
  await run("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1").catch(() => {});
}

// --- settings helpers ---
export async function getSetting(key: string): Promise<string | null> {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

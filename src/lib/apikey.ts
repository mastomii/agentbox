import { query, run, get } from "./d1";
import { randomId, sha256 } from "./crypto";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  created_at: number;
  last_used_at: number | null;
};

export async function createApiKey(name: string) {
  const raw = `ab_${randomId(24)}`;
  const id = randomId();
  const prefix = raw.slice(0, 10);
  const hash = sha256(raw);
  await run(
    "INSERT INTO api_keys (id, name, prefix, hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    [id, name || "default", prefix, hash, Date.now()]
  );
  return { id, name: name || "default", key: raw, prefix };
}

export async function listApiKeys() {
  const rows = await query<KeyRow>(
    "SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
  }));
}

export async function revokeApiKey(id: string) {
  await run("DELETE FROM api_keys WHERE id = ?", [id]);
}

export async function verifyApiKey(raw: string | null): Promise<boolean> {
  if (!raw) return false;
  const hash = sha256(raw.trim());
  const rec = await get<KeyRow>("SELECT id, last_used_at FROM api_keys WHERE hash = ?", [hash]);
  if (!rec) return false;
  // best-effort last-used update — throttled to at most once/hour so polling
  // agents don't generate a write on every request.
  const now = Date.now();
  if (!rec.last_used_at || now - rec.last_used_at > 60 * 60 * 1000) {
    run("UPDATE api_keys SET last_used_at = ? WHERE hash = ?", [now, hash]).catch(() => {});
  }
  return true;
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return req.headers.get("x-api-key");
}

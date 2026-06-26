// Cloudflare REST API client for provisioning (Workers, D1, Email Routing).
// The API token comes from the CF_API_TOKEN env var. Zone/domain are resolved
// from the token and stored in D1 (settings table).
import { cfToken, getSetting, setSetting } from "./d1";

const CF_API = "https://api.cloudflare.com/client/v4";

// Name of the shared Email Worker (one per deploy). Used at provision time and
// as the fallback when reading the persisted worker_name setting.
export const WORKER_NAME = "agentbox-email";

export type CfConfig = {
  token: string;
  accountId: string;
  zoneId: string;
  domain: string;
};

// Returns the active provisioning config, or null if not connected yet.
// token: env, accountId/zoneId/domain: D1 settings table.
// Config rarely changes — cache it in-process so the per-request settings GETs
// (called by nearly every API route) don't burn D1 read ops on every poll.
let _cfgCache: { val: CfConfig | null; at: number } | null = null;
const CFG_TTL = 60_000;

export async function getCfConfig(): Promise<CfConfig | null> {
  if (!process.env.CF_API_TOKEN) return null;
  if (_cfgCache && Date.now() - _cfgCache.at < CFG_TTL) return _cfgCache.val;
  const [accountId, zoneId, domain] = await Promise.all([
    getSetting("cf_account_id"),
    getSetting("cf_zone_id"),
    getSetting("cf_domain"),
  ]);
  const val = accountId && zoneId && domain ? { token: cfToken(), accountId, zoneId, domain } : null;
  _cfgCache = { val, at: Date.now() };
  return val;
}

export async function saveCfConfig(c: { accountId: string; zoneId: string; domain: string }) {
  await Promise.all([
    setSetting("cf_account_id", c.accountId),
    setSetting("cf_zone_id", c.zoneId),
    setSetting("cf_domain", c.domain),
  ]);
  _cfgCache = null; // invalidate
}

// --- Multi-domain support ---
// AgentBox can route mail for several zones at once. Each domain stores its own
// zoneId so per-address routing rules hit the right zone. The primary domain
// (cf_domain / cf_zone_id) stays as the default and is what provisioning wires
// the D1 database + worker against; extra domains reuse the same worker.
export type CfDomain = { domain: string; zoneId: string; accountId: string };

export async function getCfDomains(): Promise<CfDomain[]> {
  const raw = await getSetting("cf_domains");
  let list: CfDomain[] = [];
  if (raw) {
    try { list = JSON.parse(raw) as CfDomain[]; } catch { list = []; }
  }
  // Back-compat: fold the legacy single-domain settings into the list.
  const cfg = await getCfConfig();
  if (cfg && !list.some((d) => d.domain === cfg.domain)) {
    list.unshift({ domain: cfg.domain, zoneId: cfg.zoneId, accountId: cfg.accountId });
  }
  return list;
}

export async function saveCfDomains(list: CfDomain[]) {
  await setSetting("cf_domains", JSON.stringify(list));
  _cfgCache = null;
}

// Resolve a usable CfConfig for an arbitrary domain (its own zoneId).
export async function getCfConfigForDomain(domain: string): Promise<CfConfig | null> {
  if (!process.env.CF_API_TOKEN) return null;
  const d = domain.toLowerCase();
  const list = await getCfDomains();
  const hit = list.find((x) => x.domain === d);
  if (!hit) return null;
  return { token: cfToken(), accountId: hit.accountId, zoneId: hit.zoneId, domain: hit.domain };
}

type CfResp<T> = { success: boolean; errors: { code: number; message: string }[]; result: T };

async function cf<T>(
  token: string,
  endpoint: string,
  init?: RequestInit & { raw?: boolean }
): Promise<T> {
  const res = await fetch(`${CF_API}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && !init.raw ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json()) as CfResp<T>;
  if (!data.success) {
    throw new Error(data.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || "Cloudflare API error");
  }
  return data.result;
}

// --- Verify token & resolve account/zone ---
export async function verifyToken(token: string) {
  return cf<{ id: string; status: string }>(token, "/user/tokens/verify");
}

export async function listZones(token: string) {
  return cf<{ id: string; name: string; account: { id: string } }[]>(token, "/zones?per_page=50");
}

// --- Workers: upload Email Worker as a module (binds the D1 database) ---
export async function deployEmailWorker(c: CfConfig, scriptName: string, databaseId: string, workerScript: string) {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2024-09-23",
    bindings: [{ type: "d1", name: "DB", id: databaseId }],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append(
    "worker.js",
    new Blob([workerScript], { type: "application/javascript+module" }),
    "worker.js"
  );
  await cf(c.token, `/accounts/${c.accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    body: form,
    raw: true,
  });
}

// --- Per-address routing rules ---
// Each inbox creates an explicit Email Routing rule that delivers ONLY that
// address to the worker. This is the intended use of Email Routing (vs a
// catch-all that grabs *@domain, which looks like a disposable-mail service).
// Limit: ~200 rules per zone on the free plan.

export type EmailRoute = { id: string; name: string; enabled: boolean; matchers: unknown[]; actions: unknown[] };

const ROUTE_TAG = "agentbox:";

// Creates a rule routing a single address to the worker. Retries on error 2016
// ("Workers Script Info not found") which happens right after a fresh deploy.
export async function createEmailRoute(c: CfConfig, address: string, scriptName: string): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await cf<{ id: string }>(c.token, `/zones/${c.zoneId}/email/routing/rules`, {
        method: "POST",
        body: JSON.stringify({
          name: `${ROUTE_TAG}${address}`,
          enabled: true,
          matchers: [{ type: "literal", field: "to", value: address }],
          actions: [{ type: "worker", value: [scriptName] }],
        }),
      });
      return r.id;
    } catch (e) {
      lastErr = e;
      if (!String((e as Error).message).includes("2016")) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

export async function listEmailRoutes(c: CfConfig): Promise<EmailRoute[]> {
  return cf<EmailRoute[]>(c.token, `/zones/${c.zoneId}/email/routing/rules?per_page=200`);
}

export async function deleteEmailRoute(c: CfConfig, ruleId: string) {
  await fetch(`${CF_API}/zones/${c.zoneId}/email/routing/rules/${ruleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.token}` },
  }).catch(() => {});
}

// Best-effort: delete the rule whose name matches our tag + address.
export async function deleteEmailRouteByAddress(c: CfConfig, address: string) {
  const rules = await listEmailRoutes(c).catch(() => [] as EmailRoute[]);
  const match = rules.find((r) => r.name === `${ROUTE_TAG}${address}`);
  if (match) await deleteEmailRoute(c, match.id);
}

// Delete every rule AgentBox created (used by cleanup / factory reset).
export async function deleteAllAgentboxRoutes(c: CfConfig) {
  const rules = await listEmailRoutes(c).catch(() => [] as EmailRoute[]);
  await Promise.all(
    rules.filter((r) => r.name?.startsWith(ROUTE_TAG)).map((r) => deleteEmailRoute(c, r.id))
  );
}

// Email Routing must be enabled manually per zone in the Cloudflare dashboard;
// the API token can't toggle it. Once enabled, per-address rules are created at
// inbox-creation time. If routing is off, rule creation fails with a clear
// error surfaced to the user then.
export async function deleteWorker(c: CfConfig, scriptName: string) {
  await fetch(`${CF_API}/accounts/${c.accountId}/workers/scripts/${scriptName}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.token}` },
  });
}

export async function deleteD1Database(c: CfConfig, databaseId: string) {
  await fetch(`${CF_API}/accounts/${c.accountId}/d1/database/${databaseId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.token}` },
  });
}

// --- R2 bucket (attachment storage, optional — requires CC on Cloudflare) ---
const R2_BUCKET_NAME = "agentbox-attachments";
export { R2_BUCKET_NAME };

// Try to find the bucket; returns name or null.
export async function findR2Bucket(c: CfConfig): Promise<string | null> {
  try {
    const res = await cf<{ buckets: { name: string }[] }>(c.token, `/accounts/${c.accountId}/r2/buckets`);
    return res.buckets?.find((b) => b.name === R2_BUCKET_NAME)?.name ?? null;
  } catch {
    return null; // no R2 permission or no CC
  }
}

// Auto-create R2 bucket. Returns bucket name on success, null if R2 unavailable.
export async function ensureR2Bucket(c: CfConfig): Promise<string | null> {
  const existing = await findR2Bucket(c);
  if (existing) return existing;
  try {
    await cf(c.token, `/accounts/${c.accountId}/r2/buckets`, {
      method: "POST",
      body: JSON.stringify({ name: R2_BUCKET_NAME }),
    });
    return R2_BUCKET_NAME;
  } catch {
    return null; // R2 not available (no CC / permission)
  }
}

export async function deleteR2Bucket(c: CfConfig) {
  await fetch(`${CF_API}/accounts/${c.accountId}/r2/buckets/${R2_BUCKET_NAME}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.token}` },
  }).catch(() => {});
}

// Deploy worker with optional R2 binding.
export async function deployEmailWorkerWithR2(
  c: CfConfig,
  scriptName: string,
  databaseId: string,
  workerScript: string,
  r2BucketName: string | null
) {
  const bindings: unknown[] = [{ type: "d1", name: "DB", id: databaseId }];
  if (r2BucketName) {
    bindings.push({ type: "r2_bucket", name: "ATTACHMENTS", bucket_name: r2BucketName });
  }
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2024-09-23",
    bindings,
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append(
    "worker.js",
    new Blob([workerScript], { type: "application/javascript+module" }),
    "worker.js"
  );
  await cf(c.token, `/accounts/${c.accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    body: form,
    raw: true,
  });
}

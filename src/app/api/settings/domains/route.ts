import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getCfConfig,
  saveCfConfig,
  getCfDomains,
  saveCfDomains,
  verifyToken,
  listZones,
  type CfDomain,
} from "@/lib/cloudflare";
import { cfToken, hasToken } from "@/lib/d1";

// Manage the set of domains AgentBox can create inboxes on. Each must be a zone
// already on the connected Cloudflare account; we resolve its zoneId/accountId
// automatically. The first domain added becomes the primary (used for
// provisioning the shared D1 + worker).

// POST { domain } — add a domain.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasToken()) return NextResponse.json({ error: "CF_API_TOKEN env var is not set" }, { status: 400 });
  const { domain } = await req.json();
  const d = (domain || "").trim().toLowerCase();
  if (!d) return NextResponse.json({ error: "Domain required" }, { status: 400 });

  try {
    const token = cfToken();
    await verifyToken(token);
    const zones = await listZones(token);
    const zone = zones.find((z) => z.name === d);
    if (!zone) {
      return NextResponse.json(
        { error: `Domain "${d}" not found in this Cloudflare account. Available: ${zones.map((z) => z.name).join(", ") || "none"}` },
        { status: 400 }
      );
    }

    const list = await getCfDomains();
    if (list.some((x) => x.domain === d)) {
      return NextResponse.json({ error: "Domain already added" }, { status: 409 });
    }
    const entry: CfDomain = { domain: d, zoneId: zone.id, accountId: zone.account.id };
    const next = [...list, entry];
    await saveCfDomains(next);

    // If there's no primary domain yet, make this the default for provisioning.
    if (!(await getCfConfig())) {
      await saveCfConfig({ accountId: entry.accountId, zoneId: entry.zoneId, domain: entry.domain });
    }
    return NextResponse.json({ ok: true, domains: await getCfDomains() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// PATCH { domain } — make an already-added domain the primary (default for new
// inboxes + provisioning target). The worker/D1 are account-level and shared
// across domains, so switching primary is just a settings reassignment.
export async function PATCH(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { domain } = await req.json();
  const d = (domain || "").trim().toLowerCase();
  if (!d) return NextResponse.json({ error: "Domain required" }, { status: 400 });

  const list = await getCfDomains();
  const hit = list.find((x) => x.domain === d);
  if (!hit) return NextResponse.json({ error: "Domain not in the active list" }, { status: 404 });

  await saveCfConfig({ accountId: hit.accountId, zoneId: hit.zoneId, domain: hit.domain });
  return NextResponse.json({ ok: true, domains: await getCfDomains() });
}

// DELETE ?domain=... — remove a domain from the list.
// Refuses to remove the primary domain (it owns the provisioned worker/D1).
export async function DELETE(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const d = (url.searchParams.get("domain") || "").trim().toLowerCase();
  if (!d) return NextResponse.json({ error: "Domain required" }, { status: 400 });

  const cfg = await getCfConfig();
  if (cfg && cfg.domain === d) {
    return NextResponse.json({ error: "Cannot remove the primary domain" }, { status: 400 });
  }
  const list = await getCfDomains();
  await saveCfDomains(list.filter((x) => x.domain !== d));
  return NextResponse.json({ ok: true, domains: await getCfDomains() });
}

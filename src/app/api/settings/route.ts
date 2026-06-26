import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCfConfig, saveCfConfig, verifyToken, listZones, getCfDomains } from "@/lib/cloudflare";
import { cfToken, hasToken, getSetting } from "@/lib/d1";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await getCfConfig();
  return NextResponse.json({
    hasToken: hasToken(),
    configured: !!cfg,
    domain: cfg?.domain ?? null,
    accountId: cfg?.accountId ?? null,
    zoneId: cfg?.zoneId ?? null,
    domains: await getCfDomains(),
    provisioned: (await getSetting("provisioned")) === "1",
    r2Enabled: (await getSetting("r2_enabled")) === "1",
    workerName: await getSetting("worker_name"),
  });
}

// Connect: token comes from env, user only picks which domain (zone) to use.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasToken()) return NextResponse.json({ error: "CF_API_TOKEN env var is not set" }, { status: 400 });
  const { domain } = await req.json();
  if (!domain) return NextResponse.json({ error: "Domain required" }, { status: 400 });
  try {
    const token = cfToken();
    await verifyToken(token);
    const zones = await listZones(token);
    const zone = zones.find((z) => z.name === domain.toLowerCase());
    if (!zone) {
      return NextResponse.json(
        { error: `Domain "${domain}" not found in this Cloudflare account. Available: ${zones.map((z) => z.name).join(", ") || "none"}` },
        { status: 400 }
      );
    }
    await saveCfConfig({ accountId: zone.account.id, zoneId: zone.id, domain: domain.toLowerCase() });
    return NextResponse.json({ ok: true, accountId: zone.account.id, zoneId: zone.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

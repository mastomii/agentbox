import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listZones } from "@/lib/cloudflare";
import { cfToken, hasToken } from "@/lib/d1";

// Auto-fetch the zones (domains) available on this Cloudflare account so the
// UI can show a selectbox instead of making the user type a domain by hand.
//
// We can't reliably probe per-zone Email Routing status with the available
// token scope, so we list every zone and let the UI tell the user to enable
// Email Routing manually if a domain doesn't receive mail.
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasToken()) return NextResponse.json({ error: "CF_API_TOKEN env var is not set" }, { status: 400 });
  try {
    const token = cfToken();
    const zones = await listZones(token);
    const all = zones.map((z) => ({
      domain: z.name,
      zoneId: z.id,
      accountId: z.account.id,
      emailRoutingEnabled: true,
    }));
    return NextResponse.json({ zones: all });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

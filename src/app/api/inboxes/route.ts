import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCfConfig, getCfDomains } from "@/lib/cloudflare";
import { getInboxByAddress, createInbox, listInboxesWithUnread } from "@/lib/mail-store";
import { randomLocal } from "@/lib/inbox-name";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ inboxes: await listInboxesWithUnread() });
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await getCfConfig();
  if (!cfg) return NextResponse.json({ error: "Cloudflare not configured" }, { status: 400 });

  const body = await req.json().catch(() => ({ local: "", label: "", domain: "" }));
  let local = (body.local || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const label = body.label || "";
  if (!local) local = randomLocal();

  // Pick the domain: explicit choice (must be a configured zone) or the default.
  const domains = await getCfDomains();
  const reqDomain = (body.domain || "").trim().toLowerCase();
  const domain = reqDomain && domains.some((d) => d.domain === reqDomain) ? reqDomain : cfg.domain;
  const address = `${local}@${domain}`;

  if (await getInboxByAddress(address)) {
    return NextResponse.json({ error: "Address already exists" }, { status: 409 });
  }
  try {
    const inbox = await createInbox(address, label);
    return NextResponse.json({ inbox });
  } catch (e) {
    const msg = (e as Error).message;
    // Cloudflare caps Email Routing at ~200 rules per zone.
    const limit = /limit|exceed|maximum|too many/i.test(msg);
    return NextResponse.json(
      { error: limit ? "Routing rule limit reached (max 200 inboxes per domain). Delete an inbox first." : msg },
      { status: limit ? 409 : 502 }
    );
  }
}

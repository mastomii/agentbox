import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { getCfConfig } from "@/lib/cloudflare";
import { listInboxes, getInboxByAddress, createInbox } from "@/lib/mail-store";
import { randomLocal } from "@/lib/inbox-name";

// GET /v1/inboxes?limit=20&address=user@domain.com
// List the inboxes owned by the API key. Optional: limit (default 50, max 100),
// address filter for exact match.
export async function GET(req: Request) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const addressFilter = url.searchParams.get("address");
  let inboxes = await listInboxes(identity.email);
  if (addressFilter) inboxes = inboxes.filter((i) => i.address === addressFilter);
  inboxes = inboxes.slice(0, limit).map((i) => ({
    id: i.id,
    address: i.address,
    label: i.label,
    created_at: i.created_at,
    last_message_at: i.last_message_at,
  }));
  return NextResponse.json({ inboxes });
}

// POST /v1/inboxes -> generate new address agent
export async function POST(req: Request) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await getCfConfig();
  if (!cfg) return NextResponse.json({ error: "not configured" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  let local = (typeof body?.local === "string" ? body.local : "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!local) local = randomLocal();
  const address = `${local}@${cfg.domain}`;
  if (await getInboxByAddress(address, identity.email)) {
    return NextResponse.json({ error: "exists" }, { status: 409 });
  }
  try {
    const inbox = await createInbox(address, identity.email, typeof body?.label === "string" ? body.label : null);
    return NextResponse.json({ id: inbox.id, address: inbox.address });
  } catch (e) {
    const msg = (e as Error).message;
    const limit = /limit|exceed|maximum|too many/i.test(msg);
    return NextResponse.json({ error: limit ? "rule_limit_reached" : msg }, { status: limit ? 409 : 502 });
  }
}

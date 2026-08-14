import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { getInbox, listMessages } from "@/lib/mail-store";
import type { MessageRecord } from "@/lib/mail-store";

// GET /v1/inboxes/{id}/messages?wait=30&since=<ts>
// {id} is the inbox id returned by POST /v1/inboxes.
// Agent-friendly: optional long-poll via wait seconds (server polls D1).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const inbox = await getInbox(id, identity.email);
  if (!inbox) return NextResponse.json({ error: "unknown inbox" }, { status: 404 });
  const addr = inbox.address.toLowerCase();

  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") || 0);
  const wait = Math.min(Number(url.searchParams.get("wait") || 0), 55);
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 100);
  const deadline = Date.now() + wait * 1000;

  let messages = shape([], limit);
  do {
    const recs = await listMessages(addr, identity.email, since);
    messages = shape(recs, limit);
    if (messages.length > 0 || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 2500));
  } while (Date.now() < deadline);

  return NextResponse.json({ id, address: addr, count: messages.length, messages });
}

function shape(recs: MessageRecord[], limit = 100) {
  return recs.slice(0, limit).map((m) => ({
    id: m.id,
    from: m.from,
    fromName: m.fromName ?? null,
    to: m.to,
    subject: m.subject ?? null,
    text: m.text ?? null,
    receivedAt: m.receivedAt,
  }));
}

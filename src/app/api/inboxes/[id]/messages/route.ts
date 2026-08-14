import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInbox, listMessageSummaries, deleteMessages } from "@/lib/mail-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const inbox = await getInbox(id, session.email);
  if (!inbox) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Summaries come straight from D1 with one indexed query (no body columns
  // fetched) — cheap under polling.
  const sums = await listMessageSummaries(inbox.address, session.email);
  const messages = sums.map((m) => ({
    id: m.id,
    from_addr: m.from ?? null,
    from_name: m.fromName ?? null,
    to_addr: inbox.address,
    subject: m.subject ?? null,
    received_at: m.received_at,
    seen: m.seen ? 1 : 0,
    preview: m.preview ?? "",
  }));
  return NextResponse.json({ address: inbox.address, messages });
}

// Bulk delete: { ids: string[] }
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const inbox = await getInbox(id, session.email);
  if (!inbox) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({ ids: [] }));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((value: unknown): value is string => typeof value === "string") : [];
  await deleteMessages(ids, session.email, inbox.address);
  return NextResponse.json({ ok: true });
}

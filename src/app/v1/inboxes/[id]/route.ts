import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { getInbox, deleteInbox } from "@/lib/mail-store";

// DELETE /v1/inboxes/{id}
// Release an inbox: removes its Cloudflare routing rule (freeing one of the
// ~200 per-domain slots) and deletes all of its stored messages. Idempotent.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyApiKey(bearerFrom(req)))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const inbox = await getInbox(id);
  if (!inbox) return NextResponse.json({ error: "unknown inbox" }, { status: 404 });
  await deleteInbox(id);
  return NextResponse.json({ ok: true, id });
}

import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { deleteInbox, getInbox } from "@/lib/mail-store";

// DELETE /v1/inboxes/{id}
// Release an inbox owned by the API key.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const inbox = await getInbox(id, identity.email);
  if (!inbox) return NextResponse.json({ error: "unknown inbox" }, { status: 404 });
  await deleteInbox(id, identity.email);
  return NextResponse.json({ ok: true, id });
}

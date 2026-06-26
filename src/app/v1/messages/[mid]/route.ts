import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { findMessageById, listAttachments, deleteMessage } from "@/lib/mail-store";

export async function GET(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await verifyApiKey(bearerFrom(req)))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  const found = await findMessageById(mid);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = found.rec;
  const attachments = await listAttachments(mid);
  return NextResponse.json({
    message: {
      id: m.id,
      from: m.from,
      fromName: m.fromName ?? null,
      to: m.to,
      subject: m.subject ?? null,
      text: m.text ?? null,
      html: m.html ?? null,
      receivedAt: m.receivedAt,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
      })),
    },
  });
}

// DELETE /v1/messages/{mid} — delete one stored message. Idempotent.
export async function DELETE(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await verifyApiKey(bearerFrom(req)))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  await deleteMessage(mid);
  return NextResponse.json({ ok: true, id: mid });
}

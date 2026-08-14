import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { findMessageById, listAttachments, deleteMessage } from "@/lib/mail-store";
import { safeAttachmentFilename } from "@/lib/attachment-filename";

// Indirection seam so tests can substitute the side-effecting collaborators.
// Production behavior is unchanged: these are the real implementations.
export const _deps = {
  verifyApiKey,
  findMessageById,
  listAttachments,
  deleteMessage,
};

export async function GET(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const identity = await _deps.verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  const found = await _deps.findMessageById(mid, identity.email);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = found.rec;
  const attachments = await _deps.listAttachments(mid, identity.email);
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
        // finding 5: sanitize the attacker-controlled stored name before output.
        filename: safeAttachmentFilename(a.filename),
        contentType: a.content_type,
        size: a.size,
      })),
    },
  });
}

// DELETE /v1/messages/{mid} — delete one stored message. Idempotent.
export async function DELETE(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const identity = await _deps.verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  await _deps.deleteMessage(mid, identity.email);
  return NextResponse.json({ ok: true, id: mid });
}

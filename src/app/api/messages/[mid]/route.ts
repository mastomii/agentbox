import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findMessageById, deleteMessage, listAttachments } from "@/lib/mail-store";
import { safeAttachmentFilename } from "@/lib/attachment-filename";

// Indirection seam so tests can substitute the side-effecting collaborators.
// Production behavior is unchanged: these are the real implementations.
export const _deps = {
  getSession,
  findMessageById,
  deleteMessage,
  listAttachments,
};

export async function GET(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const session = await _deps.getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  const found = await _deps.findMessageById(mid, session.email);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = found.rec;
  const attachments = await _deps.listAttachments(mid, session.email);
  return NextResponse.json({
    message: {
      id: m.id,
      from_addr: m.from,
      from_name: m.fromName ?? null,
      to_addr: m.to,
      subject: m.subject ?? null,
      text_body: m.text ?? null,
      html_body: m.html ?? null,
      received_at: m.receivedAt,
      seen: 1,
      attachments: attachments.map((a) => ({
        id: a.id,
        // finding 5: sanitize the attacker-controlled stored name before output.
        filename: safeAttachmentFilename(a.filename),
        content_type: a.content_type,
        size: a.size,
      })),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const session = await _deps.getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  await _deps.deleteMessage(mid, session.email);
  return NextResponse.json({ ok: true });
}

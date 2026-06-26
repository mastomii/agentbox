import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findMessageById, deleteMessage, listAttachments } from "@/lib/mail-store";

export async function GET(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  const found = await findMessageById(mid);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = found.rec;
  const attachments = await listAttachments(mid);
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
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
      })),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  await deleteMessage(mid);
  return NextResponse.json({ ok: true });
}

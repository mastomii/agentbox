import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteInbox } from "@/lib/mail-store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteInbox(id, session.email);
  return NextResponse.json({ ok: true });
}

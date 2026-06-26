import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteInbox } from "@/lib/mail-store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteInbox(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeApiKey } from "@/lib/apikey";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await revokeApiKey(id);
  return NextResponse.json({ ok: true });
}

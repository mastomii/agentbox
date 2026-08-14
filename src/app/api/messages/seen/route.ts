import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markSeen } from "@/lib/mail-store";

// POST { ids: string[] } — mark messages as read.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({ ids: [] }));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((value: unknown): value is string => typeof value === "string") : [];
  await markSeen(ids, session.email);
  return NextResponse.json({ ok: true });
}

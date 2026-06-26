import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markSeen } from "@/lib/mail-store";

// POST { ids: string[] } — mark messages as read.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ids } = await req.json().catch(() => ({ ids: [] }));
  await markSeen(Array.isArray(ids) ? ids : []);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { markSeen } from "@/lib/mail-store";

// POST /v1/messages/seen  { ids: string[] } — mark messages as read.
export async function POST(req: Request) {
  if (!(await verifyApiKey(bearerFrom(req)))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ids } = await req.json().catch(() => ({ ids: [] }));
  const list = Array.isArray(ids) ? ids : [];
  await markSeen(list);
  return NextResponse.json({ ok: true, count: list.length });
}

import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { markSeen } from "@/lib/mail-store";

// POST /v1/messages/seen  { ids: string[] } — mark messages as read.
export async function POST(req: Request) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({ ids: [] }));
  const list = Array.isArray(body?.ids) ? body.ids.filter((value: unknown): value is string => typeof value === "string") : [];
  await markSeen(list, identity.email);
  return NextResponse.json({ ok: true, count: list.length });
}

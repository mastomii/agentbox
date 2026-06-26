import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createApiKey, listApiKeys } from "@/lib/apikey";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ keys: await listApiKeys() });
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await req.json().catch(() => ({ name: "" }));
  const created = await createApiKey(name);
  return NextResponse.json({ key: created });
}

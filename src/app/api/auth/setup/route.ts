import { NextResponse } from "next/server";
import { createSession, createUser, hasAnyUser } from "@/lib/auth";
import { isStrongPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/security";
import { hasToken, ensureDatabaseId, migrate } from "@/lib/d1";

export async function GET() {
  // The login UI only needs to know whether the first account exists.
  return NextResponse.json({ needsSetup: !(await hasAnyUser()) });
}

export async function POST(req: Request) {
  if (!hasToken()) {
    return NextResponse.json({ error: "CF_API_TOKEN env var is not set on the server" }, { status: 400 });
  }
  if (await hasAnyUser()) {
    return NextResponse.json({ error: "Already set up" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !isStrongPassword(password)) {
    return NextResponse.json(
      { error: `Email and password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters) required` },
      { status: 400 }
    );
  }
  // First run: make sure the D1 database + schema exist before the first write.
  await ensureDatabaseId();
  await migrate();
  const user = await createUser(email, password);
  await createSession(user);
  return NextResponse.json({ ok: true });
}

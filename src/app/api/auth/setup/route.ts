import { NextResponse } from "next/server";
import { createSession, createUser, hasAnyUser } from "@/lib/auth";
import { isRateLimited, recordRateLimitFailure } from "@/lib/rate-limit";
import { clientKey, isStrongPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, normalizeEmail } from "@/lib/security";
import { hasToken, ensureDatabaseId, migrate } from "@/lib/d1";

export async function GET() {
  // The login UI only needs to know whether the first account exists.
  return NextResponse.json({ needsSetup: !(await hasAnyUser()) });
}

export async function POST(req: Request) {
  const setupKey = `setup:ip:${clientKey(req)}`;
  if (await isRateLimited(setupKey, 10, 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  await recordRateLimitFailure(setupKey, 10, 60_000);

  if (!hasToken()) {
    return NextResponse.json({ error: "CF_API_TOKEN env var is not set on the server" }, { status: 400 });
  }
  if (await hasAnyUser()) {
    return NextResponse.json({ error: "Already set up" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !isStrongPassword(password)) {
    return NextResponse.json(
      { error: `Valid email and password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters) required` },
      { status: 400 }
    );
  }

  // First run: make sure the D1 database + schema exist before the first write.
  await ensureDatabaseId();
  await migrate();
  try {
    const user = await createUser(email, password);
    await createSession(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) {
      return NextResponse.json({ error: "Already set up" }, { status: 400 });
    }
    throw error;
  }
}

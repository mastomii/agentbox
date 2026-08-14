import { NextResponse } from "next/server";
import { createSession, verifyUser } from "@/lib/auth";
import { clientKey, normalizeEmail } from "@/lib/security";
import { clearRateLimit, isRateLimited, recordRateLimitFailure } from "@/lib/rate-limit";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const keys = [`login:ip:${clientKey(req)}`, `login:email:${email}`];
  if (
    (await isRateLimited(keys[0], MAX_ATTEMPTS, WINDOW_MS)) ||
    (await isRateLimited(keys[1], MAX_ATTEMPTS, WINDOW_MS))
  ) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(WINDOW_MS / 1000) } }
    );
  }

  const user = await verifyUser(email, password);
  if (!user) {
    await Promise.all(keys.map((key) => recordRateLimitFailure(key, MAX_ATTEMPTS, WINDOW_MS)));
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await Promise.all(keys.map((key) => clearRateLimit(key)));
  await createSession(user);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createSession, createUser, hasAnyUser } from "@/lib/auth";
import { clearRateLimit, isRateLimited, recordRateLimitFailure } from "@/lib/rate-limit";
import { clientKey, isStrongPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, normalizeEmail } from "@/lib/security";
import { hasToken, ensureDatabaseId, migrate } from "@/lib/d1";

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

// Indirection seam so tests can substitute the side-effecting collaborators.
// Production behavior is unchanged: these are the real implementations.
export const _deps = {
  createSession,
  createUser,
  hasAnyUser,
  clearRateLimit,
  isRateLimited,
  recordRateLimitFailure,
  hasToken,
  ensureDatabaseId,
  migrate,
};

export async function GET() {
  // The login UI only needs to know whether the first account exists.
  return NextResponse.json({ needsSetup: !(await _deps.hasAnyUser()) });
}

export async function POST(req: Request) {
  const setupKey = `setup:ip:${clientKey(req)}`;
  if (await _deps.isRateLimited(setupKey, MAX_ATTEMPTS, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(WINDOW_MS / 1000) } }
    );
  }

  if (!_deps.hasToken()) {
    await _deps.recordRateLimitFailure(setupKey, MAX_ATTEMPTS, WINDOW_MS);
    return NextResponse.json({ error: "CF_API_TOKEN env var is not set on the server" }, { status: 400 });
  }
  if (await _deps.hasAnyUser()) {
    await _deps.recordRateLimitFailure(setupKey, MAX_ATTEMPTS, WINDOW_MS);
    return NextResponse.json({ error: "Already set up" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !isStrongPassword(password)) {
    await _deps.recordRateLimitFailure(setupKey, MAX_ATTEMPTS, WINDOW_MS);
    return NextResponse.json(
      { error: `Valid email and password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters) required` },
      { status: 400 }
    );
  }

  // First run: make sure the D1 database + schema exist before the first write.
  await _deps.ensureDatabaseId();
  await _deps.migrate();
  try {
    const user = await _deps.createUser(email, password);
    await _deps.createSession(user);
    await _deps.clearRateLimit(setupKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) {
      await _deps.recordRateLimitFailure(setupKey, MAX_ATTEMPTS, WINDOW_MS);
      return NextResponse.json({ error: "Already set up" }, { status: 400 });
    }
    throw error;
  }
}

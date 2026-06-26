import { NextResponse } from "next/server";
import { createSession, verifyUser } from "@/lib/auth";

// ponytail: per-process sliding window, fine for a single-instance deploy.
// Swap for a shared store if you ever run multiple replicas.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_ATTEMPTS;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const { email, password } = await req.json();
  const user = await verifyUser(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  attempts.delete(ip);
  await createSession(user);
  return NextResponse.json({ ok: true });
}

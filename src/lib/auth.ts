import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { query, run, get } from "./d1";

const COOKIE = "agentbox_session";

// Session signing key. In every deployed/runtime context the AGENTBOX_SECRET
// env var is REQUIRED — there is no usable fallback, because silently signing
// with a publicly-known key lets anyone forge an admin session. A non-secret
// fallback is only acceptable for local `next dev` when no real secret exists.
export function authSecret(): Uint8Array {
  const s = process.env.AGENTBOX_SECRET;
  if (s && s.length >= 32) {
    return new TextEncoder().encode(s);
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.CF_PAGES) {
    throw new Error(
      "AGENTBOX_SECRET env var is required in production (min 32 chars). Generate one with: openssl rand -hex 32"
    );
  }
  // Local development only. Never use this value to sign real sessions.
  return new TextEncoder().encode("dev-insecure-secret-change-me");
}

export type SessionUser = { email: string };
type UserRecord = { email: string; passwordHash: string; createdAt: number };

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(authSecret());
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    return { email: payload.email as string };
  } catch {
    return null;
  }
}

export async function hasAnyUser(): Promise<boolean> {
  const rows = await query<{ n: number }>("SELECT COUNT(*) AS n FROM users").catch(() => []);
  return (rows[0]?.n ?? 0) > 0;
}

export async function createUser(email: string, password: string): Promise<SessionUser> {
  const e = email.trim().toLowerCase();
  const hash = await bcrypt.hash(password, 10);
  await run(
    "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash",
    [e, hash, Date.now()]
  );
  return { email: e };
}

export async function verifyUser(email: string, password: string): Promise<SessionUser | null> {
  const e = email.trim().toLowerCase();
  const rec = await get<UserRecord>("SELECT email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?", [e]);
  if (!rec) return null;
  if (!(await bcrypt.compare(password, rec.passwordHash))) return null;
  return { email: rec.email };
}

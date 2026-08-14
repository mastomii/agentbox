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
type UserRecord = { email: string; passwordHash: string; createdAt: number; sessionVersion: number };

// Bump a user's session_version. Every outstanding JWT carries the version it
// was minted with; once the DB version moves past it, getSession() rejects the
// token. This is the server-side kill switch for password changes, account
// reset, and factory reset — none of which used to invalidate live sessions.
export async function bumpSessionVersion(email: string): Promise<void> {
  await run("UPDATE users SET session_version = session_version + 1 WHERE email = ?", [
    email.trim().toLowerCase(),
  ]);
}

export async function createSession(user: SessionUser) {
  const rec = await get<{ sessionVersion: number }>(
    "SELECT session_version AS sessionVersion FROM users WHERE email = ?",
    [user.email.trim().toLowerCase()]
  );
  const sv = rec?.sessionVersion ?? 1;
  const token = await new SignJWT({ email: user.email, sv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(authSecret());
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly:true,
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
    const email = payload.email as string;
    if (!email) return null;
    // Server-side revocation: the token is only valid while its session
    // version matches the user's current version in D1. A deleted user or a
    // bumped version (password change / factory reset) invalidates the JWT
    // even though its 7-day expiry has not elapsed.
    const rec = await get<{ sessionVersion: number }>(
      "SELECT session_version AS sessionVersion FROM users WHERE email = ?",
      [email]
    );
    if (!rec) return null;
    if ((payload.sv as number | undefined) !== rec.sessionVersion) return null;
    return { email };
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
  // Plain INSERT — no upsert. The previous ON CONFLICT DO UPDATE silently
  // replaced the password of an existing account, which is an unauthenticated
  // password-reset primitive if this is ever reached for a registered email.
  // Creating an account must never mutate an existing one.
  await run("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)", [
    e,
    hash,
    Date.now(),
  ]);
  return { email: e };
}

// Precomputed bcrypt hash used to equalize response time for unknown emails.
// Without it, verifyUser() returns early for a nonexistent account (no bcrypt
// compare) but does ~100ms of work for a real one — a classic user-enumeration
// timing oracle.
const DUMMY_HASH = "$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZDk1Gz1z1z1z1z1z1z1z1z1z1z1z1W";

export async function verifyUser(email: string, password: string): Promise<SessionUser | null> {
  const e = email.trim().toLowerCase();
  const rec = await get<UserRecord>(
    "SELECT email, password_hash AS passwordHash, created_at AS createdAt, session_version AS sessionVersion FROM users WHERE email = ?",
    [e]
  );
  // Always run a bcrypt compare, against the real hash when the user exists or
  // the dummy otherwise, so the timing signal is identical either way.
  const ok = await bcrypt.compare(password, rec?.passwordHash ?? DUMMY_HASH);
  if (!rec || !ok) return null;
  return { email: rec.email };
}

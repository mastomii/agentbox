const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function isStrongPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

export function clientKey(req: Request): string {
  // Cloudflare and Vercel overwrite these at the trusted edge. Never use the
  // left-most X-Forwarded-For value: clients can prepend arbitrary addresses.
  return req.headers.get("cf-connecting-ip")?.trim() ||
    (process.env.VERCEL ? req.headers.get("x-real-ip")?.trim() || "unknown" : "unknown");
}

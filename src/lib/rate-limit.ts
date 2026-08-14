import { findDatabaseId, get, run } from "./d1";
import { RateLimitWindow } from "./rate-limit-window";

const fallback = new RateLimitWindow(5, 60_000);
let tableReady = false;
let lastCleanup = 0;

async function useDatabase(): Promise<boolean> {
  try {
    if (!(await findDatabaseId())) return false;
    if (!tableReady) {
      await run(
        "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_started INTEGER NOT NULL, count INTEGER NOT NULL)"
      );
      tableReady = true;
    }
    return true;
  } catch {
    return false;
  }
}

async function databaseBlocked(key: string, maxAttempts: number, windowMs: number): Promise<boolean> {
  if (!(await useDatabase())) return fallback.isBlocked(key);
  const row = await get<{ window_started: number; count: number }>(
    "SELECT window_started, count FROM rate_limits WHERE key = ?",
    [key]
  );
  const now = Date.now();
  if (!row || now - row.window_started >= windowMs) return false;
  return row.count >= maxAttempts;
}

async function databaseFailure(key: string, maxAttempts: number, windowMs: number): Promise<void> {
  if (!(await useDatabase())) {
    fallback.consume(key);
    return;
  }
  const now = Date.now();
  const cutoff = now - windowMs;
  await run(
    `INSERT INTO rate_limits (key, window_started, count)
     VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       window_started = CASE WHEN rate_limits.window_started <= ? THEN excluded.window_started ELSE rate_limits.window_started END,
       count = CASE
         WHEN rate_limits.window_started <= ? THEN 1
         WHEN rate_limits.count < ? THEN rate_limits.count + 1
         ELSE rate_limits.count
       END`,
    [key, now, cutoff, cutoff, maxAttempts]
  );
  if (now - lastCleanup > windowMs) {
    lastCleanup = now;
    await run("DELETE FROM rate_limits WHERE window_started < ?", [now - windowMs * 2]).catch(() => {});
  }
}

export async function isRateLimited(key: string, maxAttempts: number, windowMs: number): Promise<boolean> {
  try {
    return await databaseBlocked(key, maxAttempts, windowMs);
  } catch {
    return fallback.isBlocked(key);
  }
}

export async function recordRateLimitFailure(key: string, maxAttempts: number, windowMs: number): Promise<void> {
  try {
    await databaseFailure(key, maxAttempts, windowMs);
  } catch {
    fallback.consume(key);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  fallback.clear(key);
  if (!(await useDatabase())) return;
  await run("DELETE FROM rate_limits WHERE key = ?", [key]).catch(() => {});
}

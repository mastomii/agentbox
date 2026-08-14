import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, isStrongPassword, normalizeEmail } from "../src/lib/security.ts";
import { RateLimitWindow } from "../src/lib/rate-limit-window.ts";
import { POST as setupPost, _deps } from "../src/app/api/auth/setup/route.ts";

test("normalizeEmail canonicalizes valid setup addresses", () => {
  assert.equal(normalizeEmail("  Admin@Example.COM "), "admin@example.com");
});

test("normalizeEmail rejects malformed or oversized addresses", () => {
  assert.equal(normalizeEmail("admin@example"), null);
  assert.equal(normalizeEmail("admin@@example.com"), null);
  assert.equal(normalizeEmail(`a${"x".repeat(254)}@example.com`), null);
  assert.equal(normalizeEmail(42), null);
});

test("isStrongPassword enforces setup bounds", () => {
  assert.equal(isStrongPassword("short"), false);
  assert.equal(isStrongPassword("correct horse battery staple"), true);
  assert.equal(isStrongPassword("x".repeat(129)), false);
  assert.equal(isStrongPassword(null), false);
});

test("clientKey ignores spoofable forwarded-for headers", () => {
  const spoofed = new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(clientKey(spoofed), "unknown");

  const cloudflare = new Request("https://example.test", {
    headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "spoofed" },
  });
  assert.equal(clientKey(cloudflare), "203.0.113.10");
});

test("RateLimitWindow blocks only after the configured failures", () => {
  const limiter = new RateLimitWindow(2, 60_000);
  assert.equal(limiter.consume("account"), false);
  assert.equal(limiter.consume("account"), false);
  assert.equal(limiter.consume("account"), true);
  limiter.clear("account");
  assert.equal(limiter.consume("account"), false);
});

test("setup route records rate-limit failures only on failure and clears on success", async (t) => {
  const recorded: string[] = [];
  const cleared: string[] = [];
  const originals = { ..._deps };

  t.after(() => Object.assign(_deps, originals));
  Object.assign(_deps, {
    isRateLimited: async () => false,
    recordRateLimitFailure: async (key: string) => {
      recorded.push(key);
    },
    clearRateLimit: async (key: string) => {
      cleared.push(key);
    },
    hasAnyUser: async () => false,
    createUser: async (email: string) => ({ email }),
    createSession: async () => {},
    hasToken: () => true,
    ensureDatabaseId: async () => "db",
    migrate: async () => {},
  });

  const request = (body: unknown) =>
    new Request("https://example.test/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const valid = { email: "admin@example.com", password: "correct horse battery staple" };

  // A failed attempt consumes part of the failure budget...
  const failed = await setupPost(request({ email: "admin@example.com", password: "short" }));
  assert.equal(failed.status, 400);
  assert.deepEqual(recorded, ["setup:ip:unknown"]);
  assert.deepEqual(cleared, []);

  // ...but a successful setup must not consume the budget and resets the limiter.
  const succeeded = await setupPost(request(valid));
  assert.equal(succeeded.status, 200);
  assert.deepEqual(recorded, ["setup:ip:unknown"]);
  assert.deepEqual(cleared, ["setup:ip:unknown"]);
});

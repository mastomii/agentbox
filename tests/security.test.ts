import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, isStrongPassword, normalizeEmail } from "../src/lib/security.ts";

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

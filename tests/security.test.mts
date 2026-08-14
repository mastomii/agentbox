import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, isStrongPassword, normalizeEmail } from "../src/lib/security.ts";
import { RateLimitWindow } from "../src/lib/rate-limit-window.ts";
import { POST as setupPost, _deps } from "../src/app/api/auth/setup/route.ts";
import { EMAIL_WORKER_SOURCE } from "../src/lib/worker-template.ts";
import { GET as dashboardAttachmentGet, _deps as dashboardAttachmentDeps } from "../src/app/api/messages/[mid]/attachments/[aid]/route.ts";
import { GET as v1AttachmentGet, _deps as v1AttachmentDeps } from "../src/app/v1/messages/[mid]/attachments/[aid]/route.ts";

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

// --- finding 2: attachment R2 keys must not embed attacker-controlled filenames ---

test("worker template never derives R2 keys from attachment filenames", () => {
  // The email worker builds `attachments.r2_key`; the API routes later splice it
  // into the R2 REST object URL. Filename-derived keys would let an email sender
  // control the storage key (path segments, oversized/invalid keys, collisions).
  assert.doesNotMatch(EMAIL_WORKER_SOURCE, /r2Key\s*=[^;]*att\.filename/);
  assert.match(
    EMAIL_WORKER_SOURCE,
    /const\s+r2Key\s*=\s*id\s*\+\s*"\/"\s*\+\s*attId\s*;/,
    "R2 object keys should be <messageId>/<attachmentId> (random UUIDs only)"
  );
});

test("worker template keeps raw filename metadata out of the storage key", () => {
  // finding 5 contract: the raw display filename is preserved as metadata, it
  // just must not leak into the key. The worker keeps writing it to D1.
  assert.match(EMAIL_WORKER_SOURCE, /\.bind\(attId, id, att\.filename \|\| null,/);
  assert.doesNotMatch(EMAIL_WORKER_SOURCE, /sanitize|slugify|replace\(\[[^\]]*a-z0-9/i);
});

// Both attachment routes resolve the same collaborators through their exported
// `_deps` seam (same pattern as the setup route tests above). Auth deps are
// stubbed to succeed; fetch is stubbed per test to capture the R2 object URL.
type AttachmentRouteOverrides = {
  getAttachment?: (aid: string, email: string, mid: string) => Promise<unknown>;
  fetch?: typeof fetch;
};

function stubAttachmentDeps(t: import("node:test").TestContext, overrides: AttachmentRouteOverrides) {
  const dashboardOriginals = { ...dashboardAttachmentDeps };
  const v1Originals = { ...v1AttachmentDeps };
  t.after(() => {
    Object.assign(dashboardAttachmentDeps, dashboardOriginals);
    Object.assign(v1AttachmentDeps, v1Originals);
  });
  const json = (result: unknown) =>
    new Response(JSON.stringify({ success:true, errors: [], result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const shared = {
    getSession: async () => ({ email: "owner@example.com" }),
    verifyApiKey: async () => ({ email: "owner@example.com" }),
    getAttachment: async () => null,
    getCfConfig: async () => ({ accountId: "acc", token: "tok" }),
    getAccountId: async () => "acc",
    cfToken: () => "tok",
    fetch: (async () => json([])) as typeof fetch,
    ...overrides,
  };
  Object.assign(dashboardAttachmentDeps, shared);
  Object.assign(v1AttachmentDeps, shared);
}

const attachmentParams = Promise.resolve({ mid: "msg_1", aid: "att_1" });

test("attachment routes URL-encode R2 keys per segment so stored keys stay addressable", async (t) => {
  // A key like "msg_1/att_1" must remain an object path: '/' separates segments,
  // everything else (spaces, unicode, legacy filename characters) is encoded.
  const fetchedUrls: string[] = [];
  const json = (result: unknown) =>
    new Response(JSON.stringify({ success:true, errors: [], result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  stubAttachmentDeps(t, {
    getAttachment: async () => ({
      id: "att_1",
      message_id: "msg_1",
      filename: "invoice.pdf",
      content_type: "application/pdf",
      size: null,
      r2_key: "msg_1/att_1",
    }),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.includes("/r2/buckets/")) return new Response("bytes", { status: 200 });
      return json([]);
    }) as typeof fetch,
  });

  const dashboardReq = new Request("https://example.test/api/messages/msg_1/attachments/att_1");
  const dashboardRes = await dashboardAttachmentGet(dashboardReq, { params: attachmentParams });
  assert.equal(dashboardRes.status, 200);
  const objectUrls = fetchedUrls.filter((u) => u.includes("/r2/buckets/"));
  assert.deepEqual(objectUrls, [
    "https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/agentbox-attachments/objects/msg_1/att_1",
  ]);
});

test("dashboard and v1 attachment routes share the key-encoding contract", async (t) => {
  const fetchedUrls: string[] = [];
  const trackFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url.includes("/r2/buckets/")) return new Response("bytes", { status: 200 });
    return new Response(JSON.stringify({ success:true, errors: [], result:[] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  stubAttachmentDeps(t, {
    getAttachment: async () => ({
      id: "att_1",
      message_id: "msg_1",
      filename: "legacy report (final).pdf",
      content_type: "application/pdf",
      size: null,
      // Legacy row: keys written before finding 2 contained raw filename bytes.
      r2_key: "msg_1/0_legacy report (final).pdf",
    }),
    fetch: trackFetch,
  });

  const v1Req = new Request("https://example.test/v1/messages/msg_1/attachments/att_1", {
    headers: { authorization: "Bearer ab_test" },
  });
  const v1Res = await v1AttachmentGet(v1Req, { params: attachmentParams });
  assert.equal(v1Res.status, 200);

  const dashboardReq = new Request("https://example.test/api/messages/msg_1/attachments/att_1");
  const dashboardRes = await dashboardAttachmentGet(dashboardReq, { params: attachmentParams });
  assert.equal(dashboardRes.status, 200);

  const objectUrls = fetchedUrls.filter((u) => u.includes("/r2/buckets/"));
  assert.equal(objectUrls.length, 2);
  for (const url of objectUrls) {
    assert.match(url, /objects\/msg_1\/0_legacy%20report%20\(final\)\.pdf$/);
    assert.doesNotMatch(url, /objects\/msg_1%2F0/); // '/' must survive as the object path separator
  }
});

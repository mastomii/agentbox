import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientKey, isStrongPassword, normalizeEmail } from "../src/lib/security.ts";
import { RateLimitWindow } from "../src/lib/rate-limit-window.ts";
import { POST as setupPost, _deps } from "../src/app/api/auth/setup/route.ts";
import { EMAIL_WORKER_SOURCE } from "../src/lib/worker-template.ts";
import { GET as dashboardAttachmentGet, _deps as dashboardAttachmentDeps } from "../src/app/api/messages/[mid]/attachments/[aid]/route.ts";
import { GET as v1AttachmentGet, _deps as v1AttachmentDeps } from "../src/app/v1/messages/[mid]/attachments/[aid]/route.ts";

import { safeAttachmentFilename, contentDispositionAttachment } from "../src/lib/attachment-filename.ts";

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


// --- finding 5: attacker-controlled attachment filenames must be encoded at every output boundary ---
//
// The raw filename is sender-controlled MIME data persisted verbatim in D1
// (finding 2 contract). It is emitted as JSON (dashboard/v1 API + MCP text
// content), spliced into a Content-Disposition header, and rendered/downloaded
// in the dashboard. safeAttachmentFilename() is the single normalizer every
// one of those boundaries must use; contentDispositionAttachment() builds the
// RFC 6266/5987 header value on top of it.

test("safeAttachmentFilename strips CR/LF/control chars and header-breaking characters", () => {
  // Header/log injection: raw control bytes must never survive to a sink.
  const evil = 'x"\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>';
  assert.equal(safeAttachmentFilename(evil), "x___Content-Type: text_html_____script_alert(1)__script_");
  // Path traversal separators are rewritten, not passed through.
  assert.equal(safeAttachmentFilename("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(safeAttachmentFilename("..\\..\\windows\\system32"), ".._.._windows_system32");
  // Quotes and backslashes cannot break out of a quoted header string or attr.
  assert.equal(safeAttachmentFilename('a"b\\c.pdf'), "a_b_c.pdf");
  // C0/C1/DEL control characters are each replaced.
  assert.equal(safeAttachmentFilename("ab\x00\x1f\x7f\x85c.txt"), "ab____c.txt");
  // Safe names pass through untouched; empty/missing names get the fallback.
  assert.equal(safeAttachmentFilename("invoice (final) [v2].pdf"), "invoice (final) [v2].pdf");
  assert.equal(safeAttachmentFilename(""), "attachment");
  assert.equal(safeAttachmentFilename(null), "attachment");
  assert.equal(safeAttachmentFilename(undefined), "attachment");
  assert.equal(safeAttachmentFilename(123), "attachment");
});

test("safeAttachmentFilename preserves non-ASCII display names and bounds length", () => {
  // Unicode display names stay readable (mojibake is fine, but don't destroy it).
  assert.equal(safeAttachmentFilename("rapport été 2024.pdf"), "rapport été 2024.pdf");
  assert.equal(safeAttachmentFilename("画像.png"), "画像.png");
  // Oversized names are capped so headers/JSON stay bounded.
  const long = "a".repeat(500) + ".pdf";
  const out = safeAttachmentFilename(long);
  assert.ok(out.length <= 128, `expected <=128 chars, got ${out.length}`);
  assert.ok(out.endsWith(".pdf"));
});

test("contentDispositionAttachment emits an RFC-safe header for hostile filenames", () => {
  const evil = 'x"\r\nSet-Cookie: pwned=1\r\n\r\n<p>pwnd</p>.txt';
  const value = contentDispositionAttachment(evil);
  // Quoted-string fallback must not contain CR, LF, raw quotes or backslashes.
  const quoted = value.match(/filename="([^"]*)"/)![1];
  assert.doesNotMatch(quoted, /[\r\n"\\]/);
  const extended = value.match(/filename\*=UTF-8''([^;]+)/)![1];
  assert.equal(decodeURIComponent(extended), evil);
  assert.equal(
    contentDispositionAttachment("résumé.pdf"),
    "attachment; filename=\"r_sum_.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%2Epdf"
  );
  assert.equal(contentDispositionAttachment(null), 'attachment; filename="attachment"; filename*=UTF-8\'\'attachment');
});

test("attachment download routes never emit raw filename bytes in Content-Disposition", async (t) => {
  const raw = 'x"\r\nSet-Cookie: pwned=1\r\n\r\n<p>pwnd</p>.txt';
  stubAttachmentDeps(t, {
    getAttachment: async () => ({
      id: "att_1",
      message_id: "msg_1",
      filename: raw,
      content_type: "text/plain",
      size: null,
      r2_key: "msg_1/att_1",
    }),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/r2/buckets/")) return new Response("bytes", { status: 200 });
      return new Response(JSON.stringify({ success:true, errors: [], result:[] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });

  const dashboardReq = new Request("https://example.test/api/messages/msg_1/attachments/att_1");
  const dashboardRes = await dashboardAttachmentGet(dashboardReq, { params: attachmentParams });
  assert.equal(dashboardRes.status, 200);

  const v1Req = new Request("https://example.test/v1/messages/msg_1/attachments/att_1", {
    headers: { authorization: "Bearer ab_test" },
  });
  const v1Res = await v1AttachmentGet(v1Req, { params: attachmentParams });
  assert.equal(v1Res.status, 200);

  for (const res of [dashboardRes, v1Res]) {
    const cd = res.headers.get("content-disposition") ?? "";
    assert.doesNotMatch(cd, /[\r\n]/, "header must be a single line");
    assert.match(cd, /^attachment; filename="[^"]*"; filename\*=UTF-8''[^;]+$/);
    // The full attacker name still reaches capable clients, RFC 5987-encoded.
    const extended = cd.match(/filename\*=UTF-8''([^;]+)/)![1];
    assert.equal(decodeURIComponent(extended), raw);
  }
});

test("message detail routes emit sanitized display filenames in JSON bodies", async (t) => {
  const raw = 'x"\r\nSet-Cookie: pwned=1\r\n\r\n<p>pwnd</p>.txt';
  const { GET: dashboardMessageGet, _deps: dashboardMessageDeps } =
    await import("../src/app/api/messages/[mid]/route.ts");
  const { GET: v1MessageGet, _deps: v1MessageDeps } =
    await import("../src/app/v1/messages/[mid]/route.ts");
  const dashboardOriginals = { ...dashboardMessageDeps };
  const v1Originals = { ...v1MessageDeps };
  t.after(() => {
    Object.assign(dashboardMessageDeps, dashboardOriginals);
    Object.assign(v1MessageDeps, v1Originals);
  });
  const shared = {
    getSession: async () => ({ email: "owner@example.com" }),
    verifyApiKey: async () => ({ email: "owner@example.com" }),
    findMessageById: async () => ({
      address: "inbox@example.com",
      rec: { id: "msg_1", from: "sender@example.com", fromName: null, to: "inbox@example.com", subject: null, text: null, html: null, receivedAt: 1 },
    }),
    listAttachments: async () => [
      { id: "att_1", message_id: "msg_1", filename: raw, content_type: "text/plain", size: 3, r2_key: "msg_1/att_1" },
    ],
  };
  Object.assign(dashboardMessageDeps, shared);
  Object.assign(v1MessageDeps, shared);

  const dashboardRes = await dashboardMessageGet(
    new Request("https://example.test/api/messages/msg_1"),
    { params: Promise.resolve({ mid: "msg_1" }) }
  );
  const v1Res = await v1MessageGet(
    new Request("https://example.test/v1/messages/msg_1", { headers: { authorization: "Bearer ab_test" } }),
    { params: Promise.resolve({ mid: "msg_1" }) }
  );

  for (const res of [dashboardRes, v1Res]) {
    assert.equal(res.status, 200);
    const body = await res.json() as { message: { attachments: { filename: string }[] } };
    const emitted = body.message.attachments[0].filename;
    assert.equal(emitted, safeAttachmentFilename(raw));
    assert.notEqual(emitted, raw);
    assert.doesNotMatch(emitted, /[\r\n"\\/<>]/);
  }
});

test("every filename output boundary routes through the centralized encoder", () => {
  // finding 5 is a shared-contract fix: no sink may build its own filename
  // string from att.filename / a.filename again. Guard structurally so a
  // future route can't quietly reintroduce raw interpolation.
  const sources = {
    dashboardAttachment: readFileSync(new URL("../src/app/api/messages/[mid]/attachments/[aid]/route.ts", import.meta.url), "utf8"),
    v1Attachment: readFileSync(new URL("../src/app/v1/messages/[mid]/attachments/[aid]/route.ts", import.meta.url), "utf8"),
    dashboardMessage: readFileSync(new URL("../src/app/api/messages/[mid]/route.ts", import.meta.url), "utf8"),
    v1Message: readFileSync(new URL("../src/app/v1/messages/[mid]/route.ts", import.meta.url), "utf8"),
    mcp: readFileSync(new URL("../src/app/mcp/route.ts", import.meta.url), "utf8"),
    messageView: readFileSync(new URL("../src/components/mail/message-view.tsx", import.meta.url), "utf8"),
  };
  for (const [name, src] of Object.entries(sources)) {
    assert.match(src, /attachment-filename/, `${name} must import the centralized filename encoder`);
    assert.doesNotMatch(src, /filename="\$\{/, `${name} must not interpolate a raw filename into a header`);
    assert.doesNotMatch(src, /filename:\s*(att|a)\.filename\b/, `${name} must not emit a raw stored filename`);
  }
});


// --- finding 6: setup detection must be a re-checkable async flow, never a one-shot boolean ---
//
// The login page's "needsSetup" probe is detection of the live backend state,
// not a constant: on first run the account does not exist yet, and if
// /api/auth/setup is unreachable (proxy error, transient network failure) the
// probe rejects. A one-shot `setNeedsSetup(...)` latch freezes whichever answer
// arrived first: a failed probe permanently shows the sign-in form to an
// instance with no admin account, and a successful "needs setup" answer can
// never be confirmed stale after another client completes setup. The page must
// instead expose a retry path for the error state and re-detect before
// submitting credentials, so the form always acts on the freshest answer.

const LOGIN_PAGE_SOURCE = readFileSync(
  new URL("../src/app/login/page.tsx", import.meta.url),
  "utf8"
);

test("login page keeps the setup probe recoverable instead of latching a failed detection", () => {
  // A failed probe is an unknown state, not "already set up". The page must
  // offer a retry path (a way to run the detection again), otherwise one
  // transient error strands every unconfigured instance behind a sign-in form
  // that can never succeed.
  const probeRejections = LOGIN_PAGE_SOURCE.match(/catch\(\s*\(\)\s*=>\s*setNeedsSetup\(/g) ?? [];
  assert.ok(
    probeRejections.length === 0,
    "the /api/auth/setup probe must not one-shot latch needsSetup on failure; expose a retry path (e.g. a retry callback that re-runs the probe)"
  );
  assert.match(
    LOGIN_PAGE_SOURCE,
    /Retry/,
    "the setup-probe error state must surface a retry affordance"
  );
});

test("login page re-detects setup state before submitting credentials", () => {
  // Detection happens on mount, but the answer can go stale while the form is
  // open (a second browser tab completes the one-time setup). Submitting
  // against the stale flag posts credentials to the wrong endpoint; the fix
  // re-queries /api/auth/setup during submit so the endpoint choice uses the
  // live state.
  const probeCalls = LOGIN_PAGE_SOURCE.match(/fetch\(\s*"\/api\/auth\/setup"\s*\)/g) ?? [];
  assert.ok(
    probeCalls.length >= 2,
    `expected the setup probe to run on mount and again on submit (found ${probeCalls.length} call site(s)); the mount-time answer can go stale before the user submits`
  );
  const submitBody = LOGIN_PAGE_SOURCE.match(/async function submit[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(
    submitBody,
    /\/api\/auth\/setup/,
    "submit() must re-detect the setup state instead of reusing the stale mount-time flag"
  );
});
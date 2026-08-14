// The Email Worker source that gets uploaded to Cloudflare.
// Runs on inbound email for any address routed to it (one Email Routing rule
// per inbox, created on inbox creation). Parses with a tiny inline MIME parser
// (no dependencies, so the single-file module upload works) and INSERTs a row
// into the D1 `messages` table.
//
// D1 binding name: DB
//
// We keep parsing minimal & dependency-free so the single-file module upload works.

export const EMAIL_WORKER_SOURCE = String.raw`
function decodeQP(str) {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeBase64(str) {
  try { return atob(str.replace(/\s/g, "")); } catch { return str; }
}
function parseHeaders(block) {
  const headers = {};
  const lines = block.split(/\r?\n/);
  let cur = "";
  for (const line of lines) {
    if (/^\s/.test(line) && cur) {
      headers[cur] += " " + line.trim();
    } else {
      const idx = line.indexOf(":");
      if (idx > -1) {
        cur = line.slice(0, idx).toLowerCase();
        headers[cur] = line.slice(idx + 1).trim();
      }
    }
  }
  return headers;
}
function decodeRFC2047(s) {
  if (!s) return s;
  return s.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try {
      if (enc.toUpperCase() === "B") return decodeURIComponent(escape(decodeBase64(txt)));
      return decodeURIComponent(escape(decodeQP(txt.replace(/_/g, " "))));
    } catch { return txt; }
  });
}
function parseEmail(raw) {
  const sep = raw.indexOf("\r\n\r\n") > -1 ? "\r\n\r\n" : "\n\n";
  const splitAt = raw.indexOf(sep);
  const headerBlock = splitAt > -1 ? raw.slice(0, splitAt) : raw;
  let body = splitAt > -1 ? raw.slice(splitAt + sep.length) : "";
  const headers = parseHeaders(headerBlock);
  const ctype = headers["content-type"] || "";
  let text = "", html = "";
  const boundaryMatch = ctype.match(/boundary="?([^";]+)"?/i);
  const attachments = [];
  if (boundaryMatch) {
    const boundary = "--" + boundaryMatch[1];
    const parts = body.split(boundary);
    for (const part of parts) {
      const pSplit = part.indexOf("\r\n\r\n") > -1 ? "\r\n\r\n" : "\n\n";
      const pAt = part.indexOf(pSplit);
      if (pAt < 0) continue;
      const ph = parseHeaders(part.slice(0, pAt));
      let pbody = part.slice(pAt + pSplit.length);
      const rawBody = pbody;
      const enc = (ph["content-transfer-encoding"] || "").toLowerCase();
      if (enc.includes("base64")) pbody = decodeBase64(pbody);
      else if (enc.includes("quoted-printable")) pbody = decodeQP(pbody);
      const pct = ph["content-type"] || "";
      const disp = ph["content-disposition"] || "";
      if (pct.includes("text/plain") && !disp.includes("attachment")) { text += pbody; }
      else if (pct.includes("text/html") && !disp.includes("attachment")) { html += pbody; }
      else if (disp.includes("attachment") || disp.includes("inline") && !pct.includes("text/")) {
        const fnMatch = disp.match(/filename="?([^"\n;]+)"?/i) || pct.match(/name="?([^"\n;]+)"?/i);
        const ct = pct.split(";")[0].trim() || "application/octet-stream";
        attachments.push({ filename: fnMatch ? fnMatch[1].trim() : null, contentType: ct, raw: rawBody, isBase64: enc.includes("base64"), size: pbody.length });
      }
    }
  } else {
    const enc = (headers["content-transfer-encoding"] || "").toLowerCase();
    if (enc.includes("base64")) body = decodeBase64(body);
    else if (enc.includes("quoted-printable")) body = decodeQP(body);
    if (ctype.includes("text/html")) html = body; else text = body;
  }
  let fromName = "", fromAddr = "";
  const fromRaw = decodeRFC2047(headers["from"] || "");
  const m = fromRaw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/) || fromRaw.match(/(\S+@\S+)/);
  if (m) { if (m[2]) { fromName = m[1].trim(); fromAddr = m[2].trim(); } else { fromAddr = m[1].trim(); } }
  return { fromName, fromAddr, subject: decodeRFC2047(headers["subject"] || ""), text: text.trim(), html: html.trim(), attachments };
}

export default {
  async email(message, env) {
    const to = (message.to || "").toLowerCase();
    let raw = "";
    try {
      const reader = message.raw.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const merged = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
      raw = new TextDecoder("utf-8").decode(merged);
    } catch (e) { raw = ""; }

    const parsed = parseEmail(raw);
    const ts = Date.now();
    const id = crypto.randomUUID();
    const from = parsed.fromAddr || message.from || "";
    const preview = (parsed.text || (parsed.html || "").replace(/<[^>]+>/g, " ") || "")
      .replace(/\s+/g, " ").trim().slice(0, 140);

    try {
      await env.DB.prepare(
        "INSERT INTO messages (id, address, from_addr, from_name, subject, text, html, preview, size, seen, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
      ).bind(
        id, to, from, parsed.fromName || "", parsed.subject || "",
        parsed.text || "", parsed.html || "", preview, raw.length, ts
      ).run();
      // bump the inbox's last_message_at (no-op if the address isn't registered)
      await env.DB.prepare("UPDATE inboxes SET last_message_at = ? WHERE address = ?")
        .bind(ts, to).run();

      // Store attachments in R2 if the binding exists (optional — needs CC on CF)
      if (env.ATTACHMENTS && parsed.attachments.length > 0) {
        for (let i = 0; i < parsed.attachments.length; i++) {
          const att = parsed.attachments[i];
          const attId = crypto.randomUUID();
          // finding 2: the R2 key is <messageId>/<attachmentId> — random UUIDs
          // only. The sender-controlled filename never becomes part of the
          // storage key; it is preserved raw as D1 metadata (finding 5).
          const r2Key = id + "/" + attId;
          try {
            // Convert base64 string to bytes for R2
            let bytes;
            if (att.isBase64) {
              const bstr = atob(att.raw.replace(/\s/g, ""));
              bytes = new Uint8Array(bstr.length);
              for (let j = 0; j < bstr.length; j++) bytes[j] = bstr.charCodeAt(j);
            } else {
              bytes = new TextEncoder().encode(att.raw);
            }
            await env.ATTACHMENTS.put(r2Key, bytes, {
              httpMetadata: { contentType: att.contentType },
            });
            await env.DB.prepare(
              "INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(attId, id, att.filename || null, att.contentType, bytes.length, r2Key).run();
          } catch (e) { /* best-effort: skip failed attachment */ }
        }
      }
    } catch (e) { /* swallow: never bounce mail on a storage hiccup */ }
  },
};
`;

// Centralized safe-encoding for the attacker-controlled attachment filename
// (finding 5). The email Worker persists the sender-supplied MIME filename
// verbatim in D1 (`attachments.filename`); every output boundary — JSON API
// bodies, MCP text content, the Content-Disposition download header, and the
// dashboard anchor — must go through this module instead of emitting the raw
// stored bytes.

// Upper bound for a display filename, in UTF-16 code units. Generous for
// legitimate names while keeping JSON payloads and header values bounded.
export const ATTACHMENT_FILENAME_MAX = 128;

export const ATTACHMENT_FILENAME_FALLBACK = "attachment";

// Characters that would let a stored filename break out of its sink:
// C0/C1 controls and DEL (CR/LF header injection, log forging), '"'
// (quoted-string / attribute breakout), '/' and '\' (path traversal,
// quoted-pair escapes), and '<' / '>' (markup injection when a name is
// pasted into HTML contexts).
const UNSAFE_FILENAME_CHARS = /[\x00-\x1f\x7f-\x9f"/\\<>]/g;

// Normalize a stored (attacker-controlled) filename into a display-safe
// string: unsafe characters replaced with '_', trimmed, length-bounded,
// never empty. Unicode display characters are preserved.
export function safeAttachmentFilename(raw: unknown): string {
  if (typeof raw !== "string") return ATTACHMENT_FILENAME_FALLBACK;
  let name = raw.replace(UNSAFE_FILENAME_CHARS, "_").trim();
  if (name.length > ATTACHMENT_FILENAME_MAX) {
    const ext = pathExtension(name);
    const head = ATTACHMENT_FILENAME_MAX - ext.length;
    name = head > 0 ? name.slice(0, head) + ext : name.slice(0, ATTACHMENT_FILENAME_MAX);
  }
  return name.length > 0 ? name : ATTACHMENT_FILENAME_FALLBACK;
}

// Final ".ext" suffix of a name, if short enough to be worth preserving
// when truncating; returns "" for dotfiles and overlong extensions.
function pathExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = name.slice(dot);
  return ext.length <= 16 ? ext : "";
}

// RFC 5987 attr-char set: everything outside it must be percent-encoded.
// This deliberately excludes the attr-char sub-delims ("!#$&+-.^_`|~") from
// the check by encoding them anyway — over-encoding is valid and simpler.
const ATTR_CHAR = /^[A-Za-z0-9]$/;

function encodeRFC5987Value(value: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(value)) {
    const ch = String.fromCharCode(byte);
    out += ATTR_CHAR.test(ch) ? ch : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

// Build an RFC 6266 Content-Disposition value for an attachment download.
// `filename` is a sanitized ASCII-only quoted-string fallback (header values
// cannot reliably carry non-Latin-1 bytes; CR/LF, quotes, and backslashes
// cannot survive safeAttachmentFilename). `filename*` carries the full
// original name, RFC 5987 percent-encoded, so capable clients still see the
// sender's exact (non-empty) display name.
export function contentDispositionAttachment(raw: unknown): string {
  const fallback = safeAttachmentFilename(raw).replace(/[^\x20-\x7e]/g, "_");
  const original = typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(original)}`;
}

// Attachment R2 object keys are `<messageId>/<attachmentId>` — random UUIDs
// chosen server-side by the email Worker, never derived from the (attacker-
// controlled) MIME filename. The raw display filename stays in the D1
// `attachments.filename` metadata column (finding 5), out of the storage key.

// Encode a stored R2 key for the Cloudflare R2 REST object URL. '/' separates
// object path segments and is preserved; every other byte inside a segment is
// percent-encoded so legacy keys (written before finding 2, when raw filenames
// were embedded) still address their object exactly.
export function encodeR2Key(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

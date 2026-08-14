import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { getAttachment } from "@/lib/mail-store";
import { getCfConfig, R2_BUCKET_NAME } from "@/lib/cloudflare";
import { cfToken, getAccountId } from "@/lib/d1";
import { encodeR2Key } from "@/lib/r2-attachments";
import { contentDispositionAttachment } from "@/lib/attachment-filename";

// Indirection seam so tests can substitute the side-effecting collaborators.
// Production behavior is unchanged: these are the real implementations.
export const _deps = {
  verifyApiKey,
  getAttachment,
  getCfConfig,
  getAccountId,
  cfToken,
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
};

// GET /v1/messages/{mid}/attachments/{aid} — stream an attachment from R2.
export async function GET(req: Request, { params }: { params: Promise<{ mid: string; aid: string }> }) {
  const identity = await _deps.verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid, aid } = await params;

  const att = await _deps.getAttachment(aid, identity.email, mid);
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cfg = await _deps.getCfConfig();
  if (!cfg) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const accountId = await _deps.getAccountId();
  // Encode per segment: keep '/' as the object path separator, percent-encode
  // any legacy filename bytes stored in keys written before finding 2.
  const r2Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${R2_BUCKET_NAME}/objects/${encodeR2Key(att.r2_key)}`;
  const r2Res = await _deps.fetch(r2Url, { headers: { Authorization: `Bearer ${_deps.cfToken()}` } });
  if (!r2Res.ok) return NextResponse.json({ error: "attachment unavailable" }, { status: 502 });

  // finding 5: the stored filename is attacker-controlled; build the header
  // via the centralized RFC 6266/5987 encoder, never raw interpolation.
  return new NextResponse(r2Res.body, {
    headers: {
      "Content-Type": att.content_type || "application/octet-stream",
      "Content-Disposition": contentDispositionAttachment(att.filename),
      ...(att.size ? { "Content-Length": String(att.size) } : {}),
    },
  });
}

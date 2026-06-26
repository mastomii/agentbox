import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAttachment } from "@/lib/mail-store";
import { getCfConfig, R2_BUCKET_NAME } from "@/lib/cloudflare";
import { cfToken, getAccountId } from "@/lib/d1";

// GET /api/messages/:mid/attachments/:aid — stream attachment from R2
export async function GET(_req: Request, { params }: { params: Promise<{ mid: string; aid: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { aid } = await params;

  const att = await getAttachment(aid);
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cfg = await getCfConfig();
  if (!cfg) return NextResponse.json({ error: "not configured" }, { status: 500 });

  // Fetch from R2 via S3-compatible API or Workers API
  // Using the Cloudflare REST API for R2 objects
  const accountId = await getAccountId();
  const r2Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${R2_BUCKET_NAME}/objects/${encodeURIComponent(att.r2_key)}`;
  const r2Res = await fetch(r2Url, {
    headers: { Authorization: `Bearer ${cfToken()}` },
  });

  if (!r2Res.ok) {
    return NextResponse.json({ error: "attachment unavailable" }, { status: 502 });
  }

  const filename = att.filename || "attachment";
  return new NextResponse(r2Res.body, {
    headers: {
      "Content-Type": att.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...(att.size ? { "Content-Length": String(att.size) } : {}),
    },
  });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCfConfig, deployEmailWorkerWithR2, ensureR2Bucket, WORKER_NAME } from "@/lib/cloudflare";
import { EMAIL_WORKER_SOURCE } from "@/lib/worker-template";
import { ensureDatabaseId, migrate, setSetting } from "@/lib/d1";

// One-click provisioning: ensure D1 database (+ schema) -> upload Email Worker
// bound to it -> enable Email Routing. No catch-all: each inbox registers its
// own per-address routing rule when created (intended Email Routing usage).
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await getCfConfig();
  if (!cfg) return NextResponse.json({ error: "Cloudflare not configured" }, { status: 400 });

  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  try {
    const dbId = await ensureDatabaseId();
    await migrate();
    steps.push({ step: "D1 database ready", ok: true, detail: dbId });

    // Try R2 bucket (optional — needs CC on Cloudflare account)
    const r2Bucket = await ensureR2Bucket(cfg);
    if (r2Bucket) {
      steps.push({ step: "R2 bucket ready (attachments enabled)", ok: true, detail: r2Bucket });
    } else {
      steps.push({ step: "R2 not available (no CC?) — attachments disabled", ok: true, detail: "skipped" });
    }
    await setSetting("r2_enabled", r2Bucket ? "1" : "0");

    await deployEmailWorkerWithR2(cfg, WORKER_NAME, dbId, EMAIL_WORKER_SOURCE, r2Bucket);
    await setSetting("worker_name", WORKER_NAME);
    steps.push({ step: "Email Worker deployed", ok: true, detail: WORKER_NAME });

    // NOTE: Email Routing is NOT enabled here. It must be turned on manually per
    // domain in the Cloudflare dashboard (the API token can't toggle it). Once
    // enabled, each inbox creation registers its own per-address routing rule.
    steps.push({
      step: "Enable Email Routing manually",
      ok: true,
      detail: "Cloudflare → Email → Email Routing, per domain",
    });

    await setSetting("provisioned", "1");
    return NextResponse.json({ ok: true, steps });
  } catch (e) {
    steps.push({ step: "failed", ok: false, detail: (e as Error).message });
    return NextResponse.json({ ok: false, steps, error: (e as Error).message }, { status: 500 });
  }
}

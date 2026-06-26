import { NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/auth";
import {
  getCfConfig,
  deleteAllAgentboxRoutes,
  deleteWorker,
  deleteD1Database,
  deleteR2Bucket,
  WORKER_NAME,
} from "@/lib/cloudflare";
import { getSetting, findDatabaseId, clearDbCache } from "@/lib/d1";

// Factory reset. Tears down everything AgentBox created on Cloudflare:
// routing rules, email worker, and the D1 database — which also wipes ALL
// stored data (users, api keys, settings, inboxes, mail). The CF token (env)
// stays, so the app returns to the setup wizard afterwards.
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await getCfConfig();
  if (!cfg) return NextResponse.json({ error: "Cloudflare not configured" }, { status: 400 });

  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  const workerName = (await getSetting("worker_name")) || WORKER_NAME;
  const dbId = await findDatabaseId();

  // 1. Delete every per-address routing rule AgentBox created.
  try {
    await deleteAllAgentboxRoutes(cfg);
    steps.push({ step: "Email routing rules deleted", ok: true });
  } catch (e) {
    steps.push({ step: "Routing rules delete", ok: false, detail: (e as Error).message });
  }

  // 2. Delete the email worker.
  try {
    await deleteWorker(cfg, workerName);
    steps.push({ step: "Email Worker deleted", ok: true, detail: workerName });
  } catch (e) {
    steps.push({ step: "Worker delete", ok: false, detail: (e as Error).message });
  }

  // 3. Delete the D1 database — wipes ALL stored data.
  if (dbId) {
    try {
      await deleteD1Database(cfg, dbId);
      clearDbCache();
      steps.push({ step: "D1 database deleted (all data wiped)", ok: true, detail: dbId });
    } catch (e) {
      steps.push({ step: "D1 delete", ok: false, detail: (e as Error).message });
    }
  }

  // 4. Delete R2 bucket (best-effort).
  try {
    await deleteR2Bucket(cfg);
    steps.push({ step: "R2 bucket deleted", ok: true });
  } catch {
    steps.push({ step: "R2 bucket delete", ok: true, detail: "skipped or not found" });
  }

  // DB wiped → the logged-in user no longer exists. Kill the session so the
  // app returns cleanly to the setup wizard instead of a half-broken state.
  await destroySession();

  return NextResponse.json({ ok: true, steps, loggedOut: true });
}

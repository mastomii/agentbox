"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Cloud, Rocket, ExternalLink, Trash2, AlertTriangle, Plus, X, RefreshCw, Star, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CfDomain = { domain: string; zoneId: string; accountId: string };
type Zone = { domain: string; zoneId: string; accountId: string; emailRoutingEnabled?: boolean };

type Settings = {
  hasToken: boolean;
  configured: boolean;
  domain: string | null;
  accountId: string | null;
  zoneId: string | null;
  domains: CfDomain[];
  provisioned: boolean;
  r2Enabled: boolean;
  workerName: string | null;
};

type Step = { step: string; ok: boolean; detail?: string };

export default function SettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [pickDomain, setPickDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [removeDomainOpen, setRemoveDomainOpen] = useState(false);
  const [pendingRemoveDomain, setPendingRemoveDomain] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);

  function load() {
    fetch("/api/settings").then((r) => r.json()).then((d) => setS(d));
  }
  useEffect(load, []);

  // Auto-fetch the zones available on the connected Cloudflare account so the
  // user picks from a dropdown instead of typing a domain by hand.
  const loadZones = useCallback((showSpinner = true) => {
    if (showSpinner) setZonesLoading(true);
    return fetch("/api/settings/zones")
      .then((r) => r.json())
      .then((d) => {
        if (d.zones) setZones(d.zones);
        if (d.error) toast.error(d.error);
      })
      .finally(() => setZonesLoading(false));
  }, []);
  // Auto-load once a token is present. Don't flip the spinner synchronously in
  // the effect (cascading-render lint) — let the fetch resolve it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s?.hasToken) loadZones(false);
  }, [s?.hasToken, loadZones]);

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!pickDomain) return;
    setSaving(true);
    const res = await fetch("/api/settings/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: pickDomain }),
    });
    setSaving(false);
    const d = await res.json();
    if (!res.ok) return toast.error(d.error || "Failed");
    toast.success(`Added ${pickDomain}`);
    setPickDomain("");
    load();
  }

  function requestRemoveDomain(domain: string) {
    setPendingRemoveDomain(domain);
    setRemoveDomainOpen(true);
  }
  async function setPrimary(domain: string) {
    if (settingPrimary) return;
    setSettingPrimary(domain);
    try {
      const res = await fetch("/api/settings/domains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const d = await res.json();
      if (!res.ok) return toast.error(d.error || "Failed");
      toast.success(`${domain} is now the default`);
      load();
    } finally {
      setSettingPrimary(null);
    }
  }

  async function doRemoveDomain() {
    if (!pendingRemoveDomain) return;
    const domain = pendingRemoveDomain;
    setPendingRemoveDomain(null);
    setRemoveDomainOpen(false);
    const res = await fetch(`/api/settings/domains?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) return toast.error(d.error || "Failed");
    toast.success(`Removed ${domain}`);
    load();
  }

  async function provision() {
    setProvisioning(true);
    setSteps([]);
    const res = await fetch("/api/provision", { method: "POST" });
    const d = await res.json();
    setProvisioning(false);
    setSteps(d.steps || []);
    if (d.ok) toast.success("Provisioned! Email Routing is live.");
    else toast.error(d.error || "Provisioning failed");
    load();
  }

  async function cleanup() {
    setCleaning(true);
    setSteps([]);
    const res = await fetch("/api/provision/cleanup", { method: "POST" });
    const d = await res.json();
    setCleaning(false);
    setCleanupOpen(false);
    setConfirmText("");
    setSteps(d.steps || []);
    if (d.ok) {
      // KV (incl. users) wiped + session destroyed server-side → back to setup.
      toast.success("Cleaned up. Signing out…");
      router.push("/login");
      router.refresh();
      return;
    }
    toast.error(d.error || "Cleanup failed");
    load();
  }

  return (
    <>
      <PageHeader title="Settings" description="Connect Cloudflare and provision your email infrastructure." />
      <div className="flex-1 overflow-y-auto">
       <div className="w-full space-y-6 p-8 animate-in fade-in slide-in-from-bottom-3 duration-300">
        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-500/25 bg-orange-500/10 text-orange-400">
                <Cloud className="h-[22px] w-[22px]" />
              </div>
              <CardTitle className="text-xs font-bold uppercase tracking-tight">Cloudflare Connection</CardTitle>
              {s?.configured && (
                <Badge className="ml-auto gap-1.5 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="outline">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
                </Badge>
              )}
            </div>
            <CardDescription>
              The API token is read from the <code className="rounded bg-muted px-1 py-0.5 text-xs">CF_API_TOKEN</code> environment
              variable. Pick one or more domains (zones already in this account) to route mail for — inboxes can use any of them.{" "}
              <a className="inline-flex items-center gap-0.5 underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
                Manage tokens <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!s?.hasToken && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <span><code className="font-mono">CF_API_TOKEN</code> is not set on the server. Add it to your environment and redeploy.</span>
              </div>
            )}
            {/* Domains added so far. The first one is the primary (provisioning target). */}
            {(s?.domains?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <Label>Active domains</Label>
                <div className="space-y-1.5">
                  {s!.domains.map((d, i) => (
                    <div key={d.domain} style={{ animationDelay: `${i * 40}ms` }} className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both">
                      <Cloud className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono">{d.domain}</span>
                      {d.domain === s!.domain && (
                        <Badge variant="outline" className="ml-1 gap-1 text-xs">
                          <Star className="h-3 w-3 fill-current" /> default
                        </Badge>
                      )}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{d.zoneId.slice(0, 8)}…</span>
                      {d.domain !== s!.domain && (
                        <>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Make default" disabled={!!settingPrimary} onClick={() => setPrimary(d.domain)}>
                            {settingPrimary === d.domain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Remove domain" disabled={!!settingPrimary} onClick={() => requestRemoveDomain(d.domain)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add a domain: auto-fetched zone selectbox. */}
            <form onSubmit={addDomain} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="domain">Add a domain</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={!s?.hasToken || zonesLoading} onClick={() => loadZones()}>
                  <RefreshCw className={zonesLoading ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> Refresh
                </Button>
              </div>
              <div className="flex gap-2">
                <Select value={pickDomain} onValueChange={setPickDomain} disabled={!s?.hasToken || zonesLoading}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={zonesLoading ? "Loading zones…" : "Select a Cloudflare domain"} />
                  </SelectTrigger>
                  <SelectContent>
                    {zones
                      .filter((z) => !s?.domains?.some((d) => d.domain === z.domain))
                      .map((z) => (
                        <SelectItem key={z.zoneId} value={z.domain}>{z.domain}</SelectItem>
                      ))}
                    {zones.filter((z) => !s?.domains?.some((d) => d.domain === z.domain)).length === 0 && (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">No eligible zones available</div>
                    )}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={saving || !s?.hasToken || !pickDomain}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  All zones on the account are listed. If a domain doesn&apos;t receive mail after provisioning, enable{" "}
                  <span className="font-medium">Email Routing</span> for it manually in{" "}
                  <a className="inline-flex items-center gap-0.5 underline" href="https://dash.cloudflare.com/?to=/:account/:zone/email/routing" target="_blank" rel="noreferrer">
                    Cloudflare → Email → Email Routing <ExternalLink className="h-3 w-3" />
                  </a>, then Refresh.
                </span>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
                <Rocket className="h-[22px] w-[22px]" />
              </div>
              <CardTitle className="text-xs font-bold uppercase tracking-tight">Provisioning</CardTitle>
              {s?.provisioned && (
                <>
                  <Badge className="ml-auto gap-1.5 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="outline">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Live
                  </Badge>
                  <Badge className={`gap-1.5 ${s.r2Enabled ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"}`} variant="outline">
                    <Paperclip className="h-3 w-3" />
                    {s.r2Enabled ? "Attachments" : "No attachments"}
                  </Badge>
                </>
              )}
            </div>
            <CardDescription>
              One click: create a D1 database and deploy the email worker. Email Routing must be{" "}
              <span className="font-medium">enabled manually</span> per domain in the Cloudflare dashboard first (see above).
              Once enabled, each inbox you create gets its own routing rule (up to 200 per domain).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={provision} disabled={!s?.configured || provisioning || cleaning}>
                {provisioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {s?.provisioned ? "Re-deploy worker" : "Provision now"}
              </Button>

              <Dialog open={cleanupOpen} onOpenChange={(o) => { setCleanupOpen(o); if (!o) setConfirmText(""); }}>
                <DialogTrigger asChild>
                  <Button variant="destructive" disabled={!s?.configured || !s?.provisioned || provisioning || cleaning}>
                    {cleaning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Clean up everything
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" /> Destroy all AgentBox resources?
                    </DialogTitle>
                    <DialogDescription asChild>
                      <div className="space-y-3 pt-1">
                        <p className="font-medium text-foreground">This action is permanent and cannot be undone.</p>
                        <p>The following Cloudflare resources will be deleted:</p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          <li>All per-address routing rules for <span className="font-mono">{s?.domain || "yourdomain"}</span> — new mail stops arriving immediately</li>
                          <li>The <span className="font-mono">agentbox-email</span> Worker</li>
                          <li>The R2 bucket and all stored attachments (if enabled)</li>
                          <li>The D1 database — including <b>every stored email</b>, inbox, and account</li>
                        </ul>
                        <p className="text-sm">
                          Your Cloudflare API token and domain stay saved, so you can re-provision a clean setup afterwards.
                        </p>
                      </div>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="confirm" className="text-sm">
                      Type <span className="font-mono font-semibold text-destructive">CLEANUP</span> to confirm
                    </Label>
                    <Input
                      id="confirm"
                      autoComplete="off"
                      placeholder="CLEANUP"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      disabled={cleaning}
                    />
                  </div>
                  <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
                    <Button variant="ghost" onClick={() => setCleanupOpen(false)} disabled={cleaning}>Cancel</Button>
                    <Button variant="destructive" onClick={cleanup} disabled={cleaning || confirmText !== "CLEANUP"}>
                      {cleaning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Destroy everything
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {steps.length > 0 && (
              <div className="space-y-1.5 rounded-md border p-3 text-sm">
                {steps.map((st, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {st.ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <span className="h-4 w-4 rounded-full bg-destructive" />}
                    <span>{st.step}</span>
                    {st.detail && <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{st.detail}</span>}
                  </div>
                ))}
              </div>
            )}
            <Separator />
            <p className="text-xs text-muted-foreground">
              D1, Workers, and Email Routing are on Cloudflare&apos;s free tier and do not require a credit card.
              Attachment storage (R2) is auto-provisioned when available — R2 is free up to 10 GB/month but requires a credit card on file.
            </p>
          
      {/* Remove domain confirmation */}
      <Dialog open={removeDomainOpen} onOpenChange={setRemoveDomainOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove domain
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <span className="font-mono font-medium text-foreground">{pendingRemoveDomain}</span>? 
              All email routing rules for this domain will be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" onClick={() => setRemoveDomainOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doRemoveDomain}>Remove domain</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
</CardContent>
        </Card>
       </div>
      </div>
    </>
  );
}

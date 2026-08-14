"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff, Bot, Inbox, ShieldCheck, Cloud } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const FEATURES = [
  { icon: Inbox, title: "On-demand inboxes", desc: "Spin up any address at your domain — each gets its own route.", tint: "text-blue-400 border-blue-500/25 bg-blue-500/10" },
  { icon: Bot, title: "Built for agents", desc: "Generate inboxes & poll for email over a simple REST API.", tint: "text-purple-400 border-purple-500/25 bg-purple-500/10" },
  { icon: Cloud, title: "Cloudflare-native", desc: "Workers, D1 & Email Routing — entirely on the free tier.", tint: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10" },
];

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((d) => setNeedsSetup(d.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Failed");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <Logo size={40} className="h-10 w-10 shrink-0 rounded-xl shadow-lg shadow-blue-500/25" />
          <div>
            <span className="text-lg font-bold tracking-tight">AgentBox</span>
            <p className="text-xs font-medium leading-none text-slate-500">Email Inbox for AI agents</p>
          </div>
        </div>

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-tight tracking-tight">
              Email inboxes for your AI agents.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Self-hosted, open source, and free. Provision your email
              system on Cloudflare in one click.
            </p>
          </div>
          <ul className="space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${f.tint}`}>
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="mb-0.5 text-xs font-bold">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-blue-500" />
          No credit card required · Cloudflare free tier
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* mobile brand */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo size={36} />
            <span className="text-lg font-semibold tracking-tight">AgentBox</span>
          </div>

          {needsSetup === null ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
                <div className="h-4 w-56 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="space-y-4">
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {needsSetup ? "Create your admin account" : "Welcome back"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {needsSetup
                    ? "Set the administrator credentials to secure your dashboard."
                    : "Sign in to manage your agent inboxes."}
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={show ? "text" : "password"}
                      autoComplete={needsSetup ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={show ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {needsSetup && (
                    <p className="text-xs text-muted-foreground">Use 12–128 characters.</p>
                  )}
                </div>

                <Button type="submit" className="mt-2 w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {needsSetup ? "Create account & continue" : "Sign in"}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                {needsSetup
                  ? "This is the only account — keep these credentials safe."
                  : "Self-hosted AgentBox · your data stays on your server."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

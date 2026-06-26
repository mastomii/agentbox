"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Settings, KeyRound, Inbox, LogOut, Menu, X, Sun, Moon, AlertTriangle, Plus } from "lucide-react";
import { Logo } from "@/components/logo";
import { useTheme } from "@/components/theme-provider";
import { useDomainFilter } from "@/components/domain-filter";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DOT = ["bg-amber-500", "bg-purple-500", "bg-blue-500"];

function NavItem({
  href, label, icon: Icon, active, badge,
}: { href: string; label: string; icon: typeof Inbox; active: boolean; badge?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-3.5 py-2.5 text-sm font-semibold transition-all",
        active ? "nav-active" : "text-slate-400 hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-foreground" : "text-slate-400")} />
        <span>{label}</span>
      </div>
      {badge}
    </Link>
  );
}

export function AppShell({ children, email }: { children: React.ReactNode; email?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [keyCount, setKeyCount] = useState(0);
  const [domains, setDomains] = useState<string[]>([]);
  const { domain: activeDomain, setDomain: setActiveDomain } = useDomainFilter();
  const [configured, setConfigured] = useState(true);

  // close the mobile drawer on route change
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync UI to external route
  useEffect(() => { setOpen(false); }, [pathname]);

  // Sidebar meta: inbox/key counts, domains, provisioning state. Refreshes on
  // navigation so badges stay roughly in sync after create/delete actions.
  useEffect(() => {
    fetch("/api/inboxes").then((r) => r.json()).then((d) => {
      const total = (d.inboxes ?? []).reduce((n: number, i: { unread?: number }) => n + (i.unread || 0), 0);
      setUnreadCount(total);
    }).catch(() => {});
    fetch("/api/keys").then((r) => r.json()).then((d) => setKeyCount(d.keys?.length ?? 0)).catch(() => {});
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      const doms = (d.domains ?? []).map((x: { domain: string }) => x.domain);
      setDomains(doms);
      setConfigured(!!d.hasToken);
    }).catch(() => {});
  }, [pathname]);

  async function doLogout() {
    setLogoutOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const init = (email || "?").slice(0, 2).toUpperCase();

  const sidebar = (
    <aside className="flex h-full w-64 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar">
      <div className="flex-1 overflow-y-auto">
        {/* Brand */}
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <Logo size={40} className="h-10 w-10 shrink-0 rounded-lg bg-[#0066ff] shadow-lg shadow-blue-500/20" />
            <div>
              <span className="text-base font-extrabold tracking-tight text-foreground">AgentBox</span>
              <p className="mt-0.5 text-xs font-medium leading-none text-slate-500">Email Inbox for AI agents</p>
            </div>
          </div>
          <button className="rounded-lg border border-sidebar-border p-1.5 text-muted-foreground hover:bg-accent lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* MAIL */}
        <nav className="space-y-1.5 px-4 py-2">
          <span className="mb-2 block px-3 text-xs font-extrabold uppercase tracking-wider text-slate-500">Mail</span>
          <NavItem href="/" label="Inboxes" icon={Inbox} active={pathname === "/"}
            badge={unreadCount > 0 ? <span className="rounded-full bg-[#ff4e20] px-1.5 py-0.5 text-xs font-bold text-white shadow-sm">{unreadCount}</span> : null} />
        </nav>

        {/* CONFIGURATION */}
        <nav className="space-y-1.5 px-4 py-2">
          <span className="mb-2 block px-3 text-xs font-extrabold uppercase tracking-wider text-slate-500">Configuration</span>
          <NavItem href="/keys" label="API Keys" icon={KeyRound} active={pathname.startsWith("/keys")}
            badge={keyCount > 0 ? <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-bold text-muted-foreground">{keyCount}</span> : null} />
          <NavItem href="/settings" label="Settings" icon={Settings} active={pathname.startsWith("/settings")}
            badge={!configured ? <span className="h-2 w-2 rounded-full bg-amber-500 shadow-sm" /> : null} />
        </nav>

        {/* DOMAINS */}
        <div className="px-4 py-6">
          <div className="mb-2 flex items-center justify-between px-3 text-xs font-extrabold uppercase tracking-wider text-slate-500">
            <span>Domains</span>
            <Link href="/settings" className="rounded p-0.5 text-blue-400 hover:bg-accent"><Plus className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setActiveDomain("")}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all",
                activeDomain === "" ? "bg-accent font-semibold text-foreground" : "text-slate-400 hover:text-foreground"
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">All domains</span>
            </button>
            {domains.length === 0 ? (
              <span className="block px-3 py-1 text-xs text-slate-500">No domains yet</span>
            ) : domains.map((dom, i) => (
              <button
                key={dom}
                onClick={() => setActiveDomain(dom)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all",
                  activeDomain === dom ? "bg-accent font-semibold text-foreground" : "text-slate-400 hover:text-foreground"
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[i % DOT.length])} />
                <span className="truncate">{dom}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer: theme switch + profile */}
      <div className="space-y-4 border-t border-sidebar-border p-4">
        <div className="flex items-center rounded-md border border-border bg-muted p-1">
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
              theme === "light" ? "border border-slate-200 bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Sun className="h-3.5 w-3.5" /> Light
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
              theme === "dark" ? "border border-slate-800 bg-[#1a1d26] text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
            )}
          >
            <Moon className="h-3.5 w-3.5" /> Dark
          </button>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-blue-500/25 bg-blue-500/10 text-sm font-extrabold text-blue-500">
              {init}
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold">{email?.split("@")[0]}</h4>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </div>
          </div>
          <button
            onClick={() => setLogoutOpen(true)}
            className="shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-accent hover:text-rose-500"
            title="Sign out"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-0 transition-colors duration-300 md:p-6">
      {/* Logout confirmation */}
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Sign out
            </DialogTitle>
            <DialogDescription>Are you sure you want to sign out of AgentBox?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" onClick={() => setLogoutOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doLogout}>Sign out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating workspace card (refs frame) */}
      <div className="flex h-full max-h-full w-full max-w-[1500px] flex-col overflow-hidden border-border bg-workspace shadow-2xl transition-all duration-300 md:flex-row md:rounded-lg md:border">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 lg:hidden">
          <div className="flex items-center gap-3">
            <button className="rounded-lg border border-border p-2 hover:bg-accent" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Logo size={20} className="h-5 w-5 rounded" />
              <span className="text-sm font-extrabold">AgentBox</span>
            </div>
          </div>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-lg border border-border p-2 hover:bg-accent"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        {/* Desktop sidebar */}
        <div className="hidden lg:flex">{sidebar}</div>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 h-full animate-in slide-in-from-left duration-200 shadow-2xl">{sidebar}</div>
          </div>
        )}

        <main className="flex flex-1 flex-col overflow-hidden bg-workspace">{children}</main>
      </div>
    </div>
  );
}

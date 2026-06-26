"use client";

import { useState } from "react";
import { Plus, Inbox as InboxIcon, Copy, Trash2, MoreVertical, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Inbox } from "./types";
import { timeAgo } from "./types";

export function InboxList({
  inboxes, active, loading, configured, domains = [], onSelect, onCreate, onDelete,
}: {
  inboxes: Inbox[];
  active: Inbox | null;
  loading: boolean;
  configured: boolean;
  domains?: string[];
  onSelect: (i: Inbox) => void;
  onCreate: (local: string, label: string, domain?: string) => Promise<void>;
  onDelete: (i: Inbox) => void;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState("");
  const [label, setLabel] = useState("");
  const [domain, setDomain] = useState("");
  const [delTarget, setDelTarget] = useState<Inbox | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [creating, setCreating] = useState<null | "random" | "named">(null);
  const [deleting, setDeleting] = useState(false);

  function copy(addr: string) {
    navigator.clipboard.writeText(addr);
    toast.success("Address copied");
  }

  async function handleCreate(kind: "random" | "named") {
    if (creating) return; // guard against double-clicks
    setCreating(kind);
    try {
      await onCreate(kind === "random" ? "" : local, label, domain || domains[0]);
      setOpen(false);
      setLocal("");
      setLabel("");
      setDomain("");
    } finally {
      setCreating(null);
    }
  }

  const totalUnread = inboxes.reduce((n, i) => n + (i.unread || 0), 0);

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex h-16 items-center justify-between border-b px-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide">Inboxes</h2>
          <p className="text-xs font-medium text-muted-foreground">
            {inboxes.length} active{totalUnread > 0 && <> · <span className="text-primary">{totalUnread} unread</span></>}
          </p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!creating) { setOpen(o); if (o && !domain) setDomain(domains[0] || ""); } }}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!configured} className="rounded-lg font-bold shadow-md shadow-blue-500/10">
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate inbox</DialogTitle>
              <DialogDescription>
                Leave the address blank to auto-generate a random one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="local">Address (optional)</Label>
                <div className="flex items-center gap-1.5">
                  <Input id="local" className="flex-1" placeholder="e.g. signup-bot" value={local} disabled={!!creating} onChange={(e) => setLocal(e.target.value)} />
                  {domains.length > 1 ? (
                    <>
                      <span className="text-sm text-muted-foreground">@</span>
                      <Select value={domain} onValueChange={setDomain} disabled={!!creating}>
                        <SelectTrigger className="w-auto"><SelectValue placeholder="domain" /></SelectTrigger>
                        <SelectContent>
                          {domains.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>
                  ) : domains[0] ? (
                    <span className="shrink-0 text-sm text-muted-foreground">@{domains[0]}</span>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label (optional)</Label>
                <Input id="label" placeholder="e.g. GitHub signup agent" value={label} disabled={!!creating} onChange={(e) => setLabel(e.target.value)} />
              </div>
              {creating && (
                <p className="text-xs text-muted-foreground">Creating the address &amp; registering its Cloudflare route…</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={!!creating} onClick={() => handleCreate("random")}>
                {creating === "random" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                Random
              </Button>
              <Button disabled={!!creating} onClick={() => handleCreate("named")}>
                {creating === "named" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!configured && (
        <div className="m-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Not provisioned yet. Go to Settings to connect Cloudflare and deploy the email worker.</span>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)
          ) : inboxes.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              <InboxIcon className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No inboxes yet.
            </div>
          ) : (
            inboxes.map((inbox, i) => {
              const isActive = active?.id === inbox.id;
              return (
              <button
                key={inbox.id}
                onClick={() => onSelect(inbox)}
                style={{ animationDelay: `${i * 35}ms` }}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md border bg-muted px-3 py-3 text-left transition-all animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both",
                  isActive ? "border-border bg-accent" : "border-border/60 hover:border-border hover:bg-accent/60"
                )}
              >
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  isActive ? "bg-blue-500/25 text-blue-400" : "bg-muted text-muted-foreground"
                )}>
                  <InboxIcon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate text-sm font-semibold", inbox.unread && "font-bold")}>
                      {inbox.label || inbox.address.split("@")[0]}
                    </span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{inbox.address}</div>
                </div>
                {inbox.unread ? (
                  <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">
                    {inbox.unread}
                  </span>
                ) : inbox.last_message_at ? (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{timeAgo(inbox.last_message_at)}</span>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); copy(inbox.address); }}>
                      <Copy className="mr-2 h-4 w-4" /> Copy address
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); setDelTarget(inbox); setConfirmText(""); }}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Delete inbox — destructive, type-to-confirm */}
      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o && !deleting) { setDelTarget(null); setConfirmText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Delete inbox
            </DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-mono text-foreground">{delTarget?.address}</span> and{" "}
              <b>all of its messages</b>. New mail to this address will no longer be stored. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-del">
              Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
            </Label>
            <Input id="confirm-del" autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          </div>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button variant="ghost" disabled={deleting} onClick={() => { setDelTarget(null); setConfirmText(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || deleting}
              onClick={async () => {
                if (!delTarget) return;
                setDeleting(true);
                try { await onDelete(delTarget); }
                finally { setDeleting(false); setDelTarget(null); setConfirmText(""); }
              }}
            >
              {deleting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              Delete inbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

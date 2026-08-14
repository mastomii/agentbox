"use client";

import { useEffect, useState } from "react";
import { Mail, ChevronLeft, Loader2, Trash2, Paperclip, Download } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MessageFull } from "./types";
import { initials } from "./types";

export function MessageView({ messageId, onDeleted, onBack }: { messageId: string | null; onDeleted: () => void; onBack: () => void }) {
  const [msg, setMsg] = useState<MessageFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"text" | "html">("text");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on id change
    if (!messageId) { setMsg(null); return; }
    setLoading(true);
    fetch(`/api/messages/${messageId}`)
      .then((r) => r.json())
      .then((d) => {
        setMsg(d.message);
        setView(d.message?.html_body && !d.message?.text_body ? "html" : "text");
      })
      .finally(() => setLoading(false));
  }, [messageId]);

  async function del() {
    if (!messageId || deleting) return;
    setDeleting(true);
    try {
      await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  if (!messageId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <Mail className="mb-3 h-12 w-12 opacity-20" />
        <p className="text-sm">Select a message to read</p>
      </div>
    );
  }

  if (loading || !msg) {
    return (
      <div className="flex-1 space-y-4 p-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const date = new Date(msg.received_at).toLocaleString();
  const hasBoth = !!(msg.html_body && msg.text_body);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Top action toolbar */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 overflow-hidden border-b bg-card/80 px-4">
        <div className="min-w-0 flex items-center gap-2">
          <button onClick={onBack} className="mr-1 flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-muted-foreground hover:bg-accent lg:hidden">
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs font-bold">Back</span>
          </button>
          <span className="hidden truncate text-xs font-bold uppercase tracking-wider text-muted-foreground lg:block">Message Viewer</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasBoth && (
            <div className="flex shrink-0 rounded-lg border bg-secondary p-0.5">
              <button
                onClick={() => setView("text")}
                className={cn("rounded-md px-3 py-1 text-xs font-bold transition-all", view === "text" ? "border border-blue-500/20 bg-blue-600/10 text-blue-500" : "text-muted-foreground hover:text-foreground")}
              >Text</button>
              <button
                onClick={() => setView("html")}
                className={cn("rounded-md px-3 py-1 text-xs font-bold transition-all", view === "html" ? "border border-blue-500/20 bg-blue-600/10 text-blue-500" : "text-muted-foreground hover:text-foreground")}
              >HTML</button>
            </div>
          )}
          <button onClick={del} disabled={deleting} aria-label="Delete" className="rounded-lg border p-1.5 text-muted-foreground transition-all hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-500">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex shrink-0 items-center justify-between overflow-hidden border-b bg-sidebar/40 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-secondary text-xs font-bold">
            {initials(msg.from_name, msg.from_addr)}
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="truncate text-sm font-bold">
              {msg.from_name || msg.from_addr}
              {msg.from_name && <span className="font-normal text-muted-foreground"> &lt;{msg.from_addr}&gt;</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              to <span className="font-mono text-foreground/80">{msg.to_addr}</span> · {date}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 space-y-6 overflow-hidden p-6 pb-12">
          <h1 className="mb-2 overflow-hidden break-all text-2xl font-bold leading-snug tracking-tight">{msg.subject || "(no subject)"}</h1>
          {view === "html" && msg.html_body ? (
            <div className="rounded-lg border bg-secondary p-1">
              <iframe
                title="message"
                sandbox=""
                className="min-h-[50vh] w-full rounded-md border-0 bg-white"
                srcDoc={msg.html_body}
              />
            </div>
          ) : (
            <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-all rounded-lg border bg-secondary p-5 font-mono text-sm leading-relaxed">
              {msg.text_body || "(empty)"}
            </pre>
          )}

          {/* Attachments */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                {msg.attachments.length} attachment{msg.attachments.length > 1 ? "s" : ""}
              </div>
              <div className="min-w-0 space-y-1.5">
                {msg.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={`/api/messages/${msg.id}/attachments/${att.id}`}
                    download={att.filename || "attachment"}
                    className="flex min-w-0 items-center gap-3 overflow-hidden rounded-md border bg-secondary/60 px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{att.filename || "attachment"}</span>
                    {att.size != null && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {att.size < 1024 ? `${att.size} B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / 1048576).toFixed(1)} MB`}
                      </span>
                    )}
                    <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

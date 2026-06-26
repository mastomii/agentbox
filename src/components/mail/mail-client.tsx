"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { InboxList } from "./inbox-list";
import { MessageList } from "./message-list";
import { MessageView } from "./message-view";
import { useDomainFilter } from "@/components/domain-filter";
import { cn } from "@/lib/utils";
import type { Inbox, MessageSummary } from "./types";

// Which pane is visible on small screens. On lg+ all three show side-by-side.
type Pane = "inboxes" | "messages" | "message";

export function MailClient() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [activeInbox, setActiveInbox] = useState<Inbox | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [activeMsg, setActiveMsg] = useState<string | null>(null);
  const [loadingInboxes, setLoadingInboxes] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [domains, setDomains] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>("inboxes");
  const { domain: domainFilter } = useDomainFilter();

  // Inboxes for the selected domain ("" = all).
  const visibleInboxes = domainFilter
    ? inboxes.filter((i) => i.address.endsWith(`@${domainFilter}`))
    : inboxes;

  const loadInboxes = useCallback(async () => {
    const res = await fetch("/api/inboxes");
    if (!res.ok) return;
    const d = await res.json();
    setInboxes(d.inboxes);
    setLoadingInboxes(false);
    setActiveInbox((cur) => {
      if (!cur) return null; // start on the inbox list, don't auto-open
      const next = d.inboxes.find((i: Inbox) => i.id === cur.id);
      if (!next) return cur; // keep stale; deletion handled elsewhere
      // Preserve object identity unless fields actually changed — avoids
      // re-triggering the [activeInbox] effect (which would reset the open msg).
      const same =
        next.unread === cur.unread &&
        next.last_message_at === cur.last_message_at &&
        next.label === cur.label;
      return same ? cur : next;
    });
  }, []);

  const loadMessages = useCallback(async (inbox: Inbox, silent = false) => {
    if (!silent) setLoadingMsgs(true);
    const res = await fetch(`/api/inboxes/${inbox.id}/messages`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages);
    }
    setLoadingMsgs(false);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(d.configured && d.provisioned);
        setDomains((d.domains ?? []).map((x: { domain: string }) => x.domain));
      });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    loadInboxes();
  }, [loadInboxes]);

  // Switch inbox → reset open message + (re)load list. Keyed on id so a poll
  // that merely updates unread/last_message_at does NOT close the open email.
  useEffect(() => {
    if (!activeInbox) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset open msg on inbox switch
    setActiveMsg(null);
    loadMessages(activeInbox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInbox?.id]);

  // Poll for new mail. The D1 free tier is operation-limited, so keep this gentle:
  // refresh the open inbox's messages every 30s, and the inbox/unread list less
  // often (every 2nd tick = 60s). Pauses entirely when the tab is hidden.
  useEffect(() => {
    if (!activeInbox) return;
    let tick = 0;
    const t = setInterval(() => {
      if (document.hidden) return; // don't burn ops in background tabs
      tick++;
      loadMessages(activeInbox, true);
      if (tick % 2 === 0) loadInboxes();
    }, 30000);
    return () => clearInterval(t);
  }, [activeInbox, loadMessages, loadInboxes]);

  async function createInbox(local: string, label: string, domain?: string) {
    const res = await fetch("/api/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ local, label, domain }),
    });
    const d = await res.json();
    if (!res.ok) {
      toast.error(d.error || "Failed");
      return;
    }
    toast.success(`Created ${d.inbox.address}`);
    await loadInboxes();
    setActiveInbox(d.inbox);
    setPane("messages");
  }

  async function deleteInbox(inbox: Inbox) {
    await fetch(`/api/inboxes/${inbox.id}`, { method: "DELETE" });
    toast.success("Inbox deleted");
    if (activeInbox?.id === inbox.id) {
      setActiveInbox(null);
      setPane("inboxes");
    }
    await loadInboxes();
  }

  function selectInbox(i: Inbox) {
    setActiveInbox(i);
    setPane("messages");
  }

  async function openMessage(id: string) {
    setActiveMsg(id);
    setPane("message");
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, seen: 1 } : x)));
    await fetch("/api/messages/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    // Update the unread badge locally instead of re-fetching the whole list.
    setInboxes((list) =>
      list.map((i) => (i.id === activeInbox?.id ? { ...i, unread: Math.max(0, (i.unread || 0) - 1) } : i))
    );
  }

  async function bulkDelete(ids: string[]) {
    if (!activeInbox || !ids.length) return;
    await fetch(`/api/inboxes/${activeInbox.id}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    toast.success(`Deleted ${ids.length} message${ids.length > 1 ? "s" : ""}`);
    if (activeMsg && ids.includes(activeMsg)) {
      setActiveMsg(null);
      setPane("messages");
    }
    await loadMessages(activeInbox);
    loadInboxes();
  }

  async function markRead(ids: string[], seen: boolean) {
    if (!ids.length) return;
    if (seen) {
      await fetch("/api/messages/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    }
    setMessages((m) => m.map((x) => (ids.includes(x.id) ? { ...x, seen: seen ? 1 : 0 } : x)));
    setInboxes((list) =>
      list.map((i) => (i.id === activeInbox?.id ? { ...i, unread: messages.filter((x) => !x.seen && !ids.includes(x.id)).length } : i))
    );
  }

  const inboxOpen = activeInbox != null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left column: inbox list when browsing, message list when an inbox is open. */}
      <div className={cn(
        "h-full w-full min-w-0 shrink-0 overflow-hidden lg:flex lg:w-96 lg:border-r",
        pane === "message" ? "hidden" : "flex"
      )}>
        {inboxOpen ? (
          <div key={activeInbox.id} className="flex h-full w-full animate-in fade-in slide-in-from-left-4 duration-300">
            <MessageList
              inbox={activeInbox}
              messages={messages}
              loading={loadingMsgs}
              activeMsg={activeMsg}
              onSelect={openMessage}
              onBack={() => { setActiveInbox(null); setPane("inboxes"); }}
              onRefresh={() => activeInbox && loadMessages(activeInbox)}
              onBulkDelete={bulkDelete}
              onMarkRead={markRead}
            />
          </div>
        ) : (
          <div className="flex h-full w-full animate-in fade-in slide-in-from-left-4 duration-300">
            <InboxList
              inboxes={visibleInboxes}
              active={activeInbox}
              loading={loadingInboxes}
              configured={configured}
              domains={domains}
              onSelect={selectInbox}
              onCreate={createInbox}
              onDelete={deleteInbox}
            />
          </div>
        )}
      </div>

      {/* Right column: always present. Reading pane, or empty placeholder. */}
      <div className={cn(
        "h-full w-full min-w-0 flex-1 animate-in fade-in overflow-hidden duration-300",
        pane === "message" ? "flex lg:flex" : "hidden lg:flex"
      )}>
        {activeMsg ? (
          <MessageView
            messageId={activeMsg}
            onBack={() => setPane("messages")}
            onDeleted={() => {
              setActiveMsg(null);
              setPane("messages");
              if (activeInbox) {
                loadMessages(activeInbox);
                loadInboxes();
              }
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Mail className="h-12 w-12 opacity-20" />
            <p className="text-sm">{inboxOpen ? "Select a message to read" : "Select an inbox to view its messages"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

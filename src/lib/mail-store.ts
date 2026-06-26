// Inbox + message access, backed by D1 (SQLite).
//
// Tables (see d1.ts SCHEMA):
//   inboxes(id, address, label, route_id, created_at, last_message_at)
//   messages(id, address, from_addr, from_name, subject, text, html,
//            preview, size, seen, received_at)
//
// The email Worker INSERTs into `messages` (and bumps inboxes.last_message_at)
// by binding D1 natively. The dashboard reads/writes via D1 REST.
import { query, run, get } from "./d1";
import { getSetting } from "./d1";
import { randomId } from "./crypto";
import { getCfConfig, getCfConfigForDomain, createEmailRoute, deleteEmailRouteByAddress, WORKER_NAME } from "./cloudflare";

export type Inbox = {
  id: string;
  address: string;
  label: string | null;
  created_at: number;
  last_message_at: number | null;
};

export type MessageRecord = {
  id: string;
  to: string;
  from: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  receivedAt: number;
  size?: number;
};

type InboxRow = {
  id: string;
  address: string;
  label: string | null;
  route_id: string | null;
  created_at: number;
  last_message_at: number | null;
};

function toInbox(r: InboxRow): Inbox {
  return {
    id: r.id,
    address: r.address,
    label: r.label,
    created_at: r.created_at,
    last_message_at: r.last_message_at,
  };
}

// --- inboxes ---
export async function listInboxes(): Promise<Inbox[]> {
  const rows = await query<InboxRow>(
    "SELECT id, address, label, route_id, created_at, last_message_at FROM inboxes ORDER BY created_at DESC"
  );
  return rows.map(toInbox);
}

export async function getInbox(id: string): Promise<Inbox | null> {
  const r = await get<InboxRow>(
    "SELECT id, address, label, route_id, created_at, last_message_at FROM inboxes WHERE id = ?",
    [id]
  );
  return r ? toInbox(r) : null;
}

export async function getInboxByAddress(address: string): Promise<Inbox | null> {
  const r = await get<InboxRow>(
    "SELECT id, address, label, route_id, created_at, last_message_at FROM inboxes WHERE address = ?",
    [address.toLowerCase()]
  );
  return r ? toInbox(r) : null;
}

export async function createInbox(address: string, label?: string | null): Promise<Inbox> {
  const addr = address.toLowerCase();
  const id = `inbox_${randomId(8)}`;

  // Register an explicit Email Routing rule that delivers this address to the
  // worker. Fails loudly (e.g. the ~200-rule limit) so the caller can report it.
  // Use the zone that owns this address's domain (multi-domain aware).
  const domain = addr.split("@")[1] || "";
  const cfg = (await getCfConfigForDomain(domain)) || (await getCfConfig());
  if (!cfg) throw new Error("Cloudflare not configured");
  const workerName = (await getSetting("worker_name")) || WORKER_NAME;
  const routeId = await createEmailRoute(cfg, addr, workerName);

  const createdAt = Date.now();
  await run(
    "INSERT INTO inboxes (id, address, label, route_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, NULL)",
    [id, addr, label || null, routeId, createdAt]
  );
  return { id, address: addr, label: label || null, created_at: createdAt, last_message_at: null };
}

export async function deleteInbox(id: string): Promise<void> {
  const inbox = await getInbox(id);
  if (!inbox) return;
  // Remove the Cloudflare routing rule for this address (best-effort, in its zone).
  const domain = inbox.address.split("@")[1] || "";
  const cfg = (await getCfConfigForDomain(domain)) || (await getCfConfig());
  if (cfg) await deleteEmailRouteByAddress(cfg, inbox.address).catch(() => {});
  // One DELETE wipes all the inbox's mail; one removes the inbox.
  await run("DELETE FROM messages WHERE address = ?", [inbox.address]);
  await run("DELETE FROM inboxes WHERE id = ?", [id]);
}

// --- messages ---
type MsgRow = {
  id: string;
  address: string;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  preview: string | null;
  size: number | null;
  seen: number;
  received_at: number;
};

function toRecord(r: MsgRow): MessageRecord {
  return {
    id: r.id,
    to: r.address,
    from: r.from_addr || "",
    fromName: r.from_name || undefined,
    subject: r.subject || undefined,
    text: r.text || undefined,
    html: r.html || undefined,
    receivedAt: r.received_at,
    size: r.size ?? undefined,
  };
}

// Lightweight summaries for the inbox list view — no body columns fetched.
export type MessageSummary = {
  id: string;
  from: string | null;
  fromName: string | null;
  subject: string | null;
  preview: string;
  received_at: number;
  seen: boolean;
};

export async function listMessageSummaries(address: string, limit = 200): Promise<MessageSummary[]> {
  const rows = await query<{
    id: string;
    from_addr: string | null;
    from_name: string | null;
    subject: string | null;
    preview: string | null;
    received_at: number;
    seen: number;
  }>(
    "SELECT id, from_addr, from_name, subject, preview, received_at, seen FROM messages WHERE address = ? ORDER BY received_at DESC LIMIT ?",
    [address.toLowerCase(), limit]
  );
  return rows.map((r) => ({
    id: r.id,
    from: r.from_addr,
    fromName: r.from_name,
    subject: r.subject,
    preview: r.preview || "",
    received_at: r.received_at,
    seen: !!r.seen,
  }));
}

export async function listMessages(address: string, since = 0): Promise<MessageRecord[]> {
  const rows = await query<MsgRow>(
    "SELECT * FROM messages WHERE address = ? AND received_at > ? ORDER BY received_at DESC LIMIT 200",
    [address.toLowerCase(), since]
  );
  return rows.map(toRecord);
}

// Find a message by id alone (used by the dashboard message endpoint).
export async function findMessageById(id: string): Promise<{ address: string; rec: MessageRecord } | null> {
  const r = await get<MsgRow>("SELECT * FROM messages WHERE id = ?", [id]);
  return r ? { address: r.address, rec: toRecord(r) } : null;
}

export async function deleteMessage(id: string): Promise<void> {
  await run("DELETE FROM messages WHERE id = ?", [id]);
}

export async function deleteMessages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);
}

// --- read/unread state ---
export async function markSeen(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await run(`UPDATE messages SET seen = 1 WHERE id IN (${placeholders})`, ids);
}

// --- attachments ---
export type AttachmentMeta = {
  id: string;
  message_id: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  r2_key: string;
};

export async function listAttachments(messageId: string): Promise<AttachmentMeta[]> {
  return query<AttachmentMeta>(
    "SELECT id, message_id, filename, content_type, size, r2_key FROM attachments WHERE message_id = ?",
    [messageId]
  );
}

export async function getAttachment(attachmentId: string): Promise<AttachmentMeta | null> {
  return get<AttachmentMeta>(
    "SELECT id, message_id, filename, content_type, size, r2_key FROM attachments WHERE id = ?",
    [attachmentId]
  );
}

// One call → inboxes + their unread counts (a single grouped query).
export async function listInboxesWithUnread(): Promise<(Inbox & { unread: number })[]> {
  const rows = await query<InboxRow & { unread: number }>(
    `SELECT i.id, i.address, i.label, i.route_id, i.created_at, i.last_message_at,
            COALESCE(SUM(CASE WHEN m.seen = 0 THEN 1 ELSE 0 END), 0) AS unread
       FROM inboxes i
       LEFT JOIN messages m ON m.address = i.address
      GROUP BY i.id
      ORDER BY i.created_at DESC`
  );
  return rows.map((r) => ({ ...toInbox(r), unread: Number(r.unread) || 0 }));
}

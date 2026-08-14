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
  owner_email: string | null;
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
export async function listInboxes(ownerEmail: string): Promise<Inbox[]> {
  const rows = await query<InboxRow>(
    "SELECT id, address, label, route_id, owner_email, created_at, last_message_at FROM inboxes WHERE owner_email = ? ORDER BY created_at DESC",
    [ownerEmail]
  );
  return rows.map(toInbox);
}

export async function getInbox(id: string, ownerEmail: string): Promise<Inbox | null> {
  const r = await get<InboxRow>(
    "SELECT id, address, label, route_id, owner_email, created_at, last_message_at FROM inboxes WHERE id = ? AND owner_email = ?",
    [id, ownerEmail]
  );
  return r ? toInbox(r) : null;
}

export async function getInboxByAddress(address: string, ownerEmail: string): Promise<Inbox | null> {
  const r = await get<InboxRow>(
    "SELECT id, address, label, route_id, owner_email, created_at, last_message_at FROM inboxes WHERE address = ? AND owner_email = ?",
    [address.toLowerCase(), ownerEmail]
  );
  return r ? toInbox(r) : null;
}

export async function createInbox(
  address: string,
  ownerEmail: string,
  label?: string | null,
): Promise<Inbox> {
  const addr = address.toLowerCase();
  const owner = ownerEmail.trim().toLowerCase();
  if (!owner) throw new Error("Inbox owner is required");
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
    "INSERT INTO inboxes (id, address, label, route_id, owner_email, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    [id, addr, label || null, routeId, owner, createdAt]
  );
  return { id, address: addr, label: label || null, created_at: createdAt, last_message_at: null };
}

export async function deleteInbox(id: string, ownerEmail: string): Promise<void> {
  const inbox = await getInbox(id, ownerEmail);
  if (!inbox) return;
  // Remove the Cloudflare routing rule for this address (best-effort, in its zone).
  const domain = inbox.address.split("@")[1] || "";
  const cfg = (await getCfConfigForDomain(domain)) || (await getCfConfig());
  if (cfg) await deleteEmailRouteByAddress(cfg, inbox.address).catch(() => {});
  await run("DELETE FROM messages WHERE address = ?", [inbox.address]);
  await run("DELETE FROM inboxes WHERE id = ? AND owner_email = ?", [id, ownerEmail]);
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

export async function listMessageSummaries(
  address: string,
  ownerEmail: string,
  limit = 200,
): Promise<MessageSummary[]> {
  const rows = await query<{
    id: string;
    from_addr: string | null;
    from_name: string | null;
    subject: string | null;
    preview: string | null;
    received_at: number;
    seen: number;
  }>(
    "SELECT m.id, m.from_addr, m.from_name, m.subject, m.preview, m.received_at, m.seen FROM messages m JOIN inboxes i ON i.address = m.address WHERE m.address = ? AND i.owner_email = ? ORDER BY m.received_at DESC LIMIT ?",
    [address.toLowerCase(), ownerEmail, limit]
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

export async function listMessages(
  address: string,
  ownerEmail: string,
  since = 0,
): Promise<MessageRecord[]> {
  const rows = await query<MsgRow>(
    "SELECT m.* FROM messages m JOIN inboxes i ON i.address = m.address WHERE m.address = ? AND i.owner_email = ? AND m.received_at > ? ORDER BY m.received_at DESC LIMIT 200",
    [address.toLowerCase(), ownerEmail, since]
  );
  return rows.map(toRecord);
}

export async function findMessageById(
  id: string,
  ownerEmail: string,
): Promise<{ address: string; rec: MessageRecord } | null> {
  const r = await get<MsgRow>(
    "SELECT m.* FROM messages m JOIN inboxes i ON i.address = m.address WHERE m.id = ? AND i.owner_email = ?",
    [id, ownerEmail]
  );
  return r ? { address: r.address, rec: toRecord(r) } : null;
}

export async function deleteMessage(id: string, ownerEmail: string): Promise<void> {
  await run(
    "DELETE FROM messages WHERE id = ? AND EXISTS (SELECT 1 FROM inboxes i WHERE i.address = messages.address AND i.owner_email = ?)",
    [id, ownerEmail]
  );
}

export async function deleteMessages(ids: string[], ownerEmail: string, address?: string): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const addressClause = address ? " AND address = ?" : "";
  await run(
    `DELETE FROM messages WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM inboxes i WHERE i.address = messages.address AND i.owner_email = ?)${addressClause}`,
    address ? [...ids, ownerEmail, address] : [...ids, ownerEmail]
  );
}

// --- read/unread state ---
export async function markSeen(ids: string[], ownerEmail: string): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await run(
    `UPDATE messages SET seen = 1 WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM inboxes i WHERE i.address = messages.address AND i.owner_email = ?)`,
    [...ids, ownerEmail]
  );
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

export async function listAttachments(messageId: string, ownerEmail: string): Promise<AttachmentMeta[]> {
  return query<AttachmentMeta>(
    `SELECT a.id, a.message_id, a.filename, a.content_type, a.size, a.r2_key
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN inboxes i ON i.address = m.address
      WHERE a.message_id = ? AND i.owner_email = ?`,
    [messageId, ownerEmail]
  );
}

export async function getAttachment(
  attachmentId: string,
  ownerEmail: string,
  messageId?: string,
): Promise<AttachmentMeta | null> {
  const pathClause = messageId ? " AND a.message_id = ?" : "";
  const params = messageId ? [attachmentId, ownerEmail, messageId] : [attachmentId, ownerEmail];
  return get<AttachmentMeta>(
    `SELECT a.id, a.message_id, a.filename, a.content_type, a.size, a.r2_key
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN inboxes i ON i.address = m.address
      WHERE a.id = ? AND i.owner_email = ?${pathClause}`,
    params
  );
}

// One call → inboxes + their unread counts (a single grouped query).
export async function listInboxesWithUnread(ownerEmail: string): Promise<(Inbox & { unread: number })[]> {
  const rows = await query<InboxRow & { unread: number }>(
    `SELECT i.id, i.address, i.label, i.route_id, i.owner_email, i.created_at, i.last_message_at,
            COALESCE(SUM(CASE WHEN m.seen = 0 THEN 1 ELSE 0 END), 0) AS unread
       FROM inboxes i
       LEFT JOIN messages m ON m.address = i.address
      WHERE i.owner_email = ?
      GROUP BY i.id
      ORDER BY i.created_at DESC`,
    [ownerEmail]
  );
  return rows.map((r) => ({ ...toInbox(r), unread: Number(r.unread) || 0 }));
}

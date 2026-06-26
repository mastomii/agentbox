export type Inbox = {
  id: string;
  address: string;
  label: string | null;
  created_at: number;
  last_message_at: number | null;
  unread?: number;
};

export type MessageSummary = {
  id: string;
  from_addr: string | null;
  from_name: string | null;
  to_addr: string | null;
  subject: string | null;
  received_at: number;
  seen: number;
  preview: string;
};

export type AttachmentInfo = {
  id: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
};

export type MessageFull = {
  id: string;
  inbox_address: string;
  from_addr: string | null;
  from_name: string | null;
  to_addr: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: number;
  seen: number;
  attachments?: AttachmentInfo[];
};

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name?: string | null, addr?: string | null): string {
  const s = (name || addr || "?").trim();
  const parts = s.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

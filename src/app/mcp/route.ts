import { NextResponse } from "next/server";
import { bearerFrom, verifyApiKey } from "@/lib/apikey";
import { getCfConfig } from "@/lib/cloudflare";
import { getSetting } from "@/lib/d1";
import { randomLocal } from "@/lib/inbox-name";
import {
  listInboxes, getInboxByAddress, getInbox, createInbox, deleteInbox,
  listMessages, findMessageById, listAttachments, deleteMessage,
  getAttachment, markSeen,
} from "@/lib/mail-store";
import type { MessageRecord } from "@/lib/mail-store";

// MCP Streamable-HTTP endpoint (POST /mcp). JSON-RPC 2.0. Same Bearer/x-api-key
// auth as /v1, same tools 1:1. get_attachment only advertised when R2 enabled.
// ponytail: manual JSON-RPC, no @modelcontextprotocol/sdk. Add SDK only if a
// client needs SSE notifications or strict session-id handling.

const PROTOCOL_VERSION = "2025-06-18";

type Rpc = { jsonrpc: "2.0"; id?: unknown; method: string; params?: Record<string, unknown> };
const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (data: unknown) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

const baseTools = [
  {
    name: "list_inboxes",
    description: "List inboxes. Optional limit (max 100) and exact address filter.",
    inputSchema: { type: "object", properties: { limit: { type: "number" }, address: { type: "string" } } },
  },
  {
    name: "create_inbox",
    description: "Create a new inbox address. Optional local part and label; random local if omitted.",
    inputSchema: { type: "object", properties: { local: { type: "string" }, label: { type: "string" } } },
  },
  {
    name: "delete_inbox",
    description: "Release an inbox by id: removes its routing rule and stored messages. Idempotent.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_messages",
    description: "List messages in an inbox. Optional since (ts), wait (long-poll seconds, max 55), limit (max 100).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, since: { type: "number" }, wait: { type: "number" }, limit: { type: "number" } }, required: ["id"] },
  },
  {
    name: "get_message",
    description: "Get one message by id, including body and attachment metadata.",
    inputSchema: { type: "object", properties: { mid: { type: "string" } }, required: ["mid"] },
  },
  {
    name: "delete_message",
    description: "Delete one stored message by id. Idempotent.",
    inputSchema: { type: "object", properties: { mid: { type: "string" } }, required: ["mid"] },
  },
  {
    name: "mark_seen",
    description: "Mark messages as read by id list.",
    inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
  },
];

const attachmentTool = {
  name: "get_attachment",
  description: "Get attachment metadata and a download URL (fetch with your API key). Requires R2.",
  inputSchema: { type: "object", properties: { mid: { type: "string" }, aid: { type: "string" } }, required: ["mid", "aid"] },
};

function shapeMessages(recs: MessageRecord[], limit = 100) {
  return recs.slice(0, limit).map((m) => ({
    id: m.id, from: m.from, fromName: m.fromName ?? null, to: m.to,
    subject: m.subject ?? null, text: m.text ?? null, receivedAt: m.receivedAt,
  }));
}

async function callTool(origin: string, name: string, raw: Record<string, unknown>, ownerEmail: string) {
  const args = raw as {
    limit?: number; address?: string; local?: string; label?: string;
    id?: string; mid?: string; aid?: string; since?: number; wait?: number; ids?: unknown;
  };
  switch (name) {
    case "list_inboxes": {
      const limit = Math.min(Number(args.limit) || 50, 100);
      let inboxes = await listInboxes(ownerEmail);
      if (args.address) inboxes = inboxes.filter((i) => i.address === args.address);
      return text({ inboxes: inboxes.slice(0, limit).map((i) => ({ id: i.id, address: i.address, label: i.label, created_at: i.created_at, last_message_at: i.last_message_at })) });
    }
    case "create_inbox": {
      const cfg = await getCfConfig();
      if (!cfg) throw new Error("not configured");
      let local = (args.local || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!local) local = randomLocal();
      const address = `${local}@${cfg.domain}`;
      if (await getInboxByAddress(address, ownerEmail)) throw new Error("inbox already exists");
      try {
        const inbox = await createInbox(address, ownerEmail, args.label || null);
        return text({ id: inbox.id, address: inbox.address });
      } catch (e) {
        const msg = (e as Error).message;
        throw new Error(/limit|exceed|maximum|too many/i.test(msg) ? "rule_limit_reached" : msg);
      }
    }
    case "delete_inbox": {
      if (!args.id) throw new Error("id required");
      const inbox = await getInbox(args.id, ownerEmail);
      if (!inbox) throw new Error("unknown inbox");
      await deleteInbox(args.id, ownerEmail);
      return text({ ok: true, id: args.id });
    }
    case "list_messages": {
      if (!args.id) throw new Error("id required");
      const inbox = await getInbox(args.id, ownerEmail);
      if (!inbox) throw new Error("unknown inbox");
      const addr = inbox.address.toLowerCase();
      const since = Number(args.since) || 0;
      const wait = Math.min(Number(args.wait) || 0, 55);
      const limit = Math.min(Number(args.limit) || 100, 100);
      const deadline = Date.now() + wait * 1000;
      let messages = shapeMessages([], limit);
      do {
        messages = shapeMessages(await listMessages(addr, ownerEmail, since), limit);
        if (messages.length > 0 || Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 2500));
      } while (Date.now() < deadline);
      return text({ id: args.id, address: addr, count: messages.length, messages });
    }
    case "get_message": {
      if (!args.mid) throw new Error("mid required");
      const found = await findMessageById(args.mid, ownerEmail);
      if (!found) throw new Error("message not found");
      const m = found.rec;
      const attachments = await listAttachments(args.mid, ownerEmail);
      return text({
        message: {
          id: m.id, from: m.from, fromName: m.fromName ?? null, to: m.to,
          subject: m.subject ?? null, text: m.text ?? null, html: m.html ?? null, receivedAt: m.receivedAt,
          attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size })),
        },
      });
    }
    case "delete_message": {
      if (!args.mid) throw new Error("mid required");
      await deleteMessage(args.mid, ownerEmail);
      return text({ ok: true, id: args.mid });
    }
    case "mark_seen": {
      const ids = (Array.isArray(args.ids) ? args.ids : []).filter((id): id is string => typeof id === "string");
      await markSeen(ids, ownerEmail);
      return text({ ok: true, count: ids.length });
    }
    case "get_attachment": {
      if ((await getSetting("r2_enabled")) !== "1") throw new Error("attachments unavailable: R2 not enabled");
      if (!args.mid || !args.aid) throw new Error("mid and aid required");
      const att = await getAttachment(args.aid, ownerEmail, args.mid);
      if (!att) throw new Error("attachment not found");
      return text({ id: att.id, filename: att.filename, contentType: att.content_type, size: att.size, url: `${origin}/v1/messages/${args.mid}/attachments/${args.aid}` });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function POST(req: Request) {
  const identity = await verifyApiKey(bearerFrom(req));
  if (!identity) return NextResponse.json(err(null, -32001, "unauthorized"), { status: 401 });

  const rpc = (await req.json().catch(() => null)) as Rpc | null;
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return NextResponse.json(err(rpc?.id ?? null, -32600, "invalid request"), { status: 400 });
  }

  // Notifications (no id) — ack with 202, no body.
  if (rpc.id === undefined) return new NextResponse(null, { status: 202 });

  try {
    switch (rpc.method) {
      case "initialize":
        return NextResponse.json(ok(rpc.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "agentbox", version: "0.1.0" },
        }));
      case "ping":
        return NextResponse.json(ok(rpc.id, {}));
      case "tools/list": {
        const r2 = (await getSetting("r2_enabled")) === "1";
        return NextResponse.json(ok(rpc.id, { tools: r2 ? [...baseTools, attachmentTool] : baseTools }));
      }
      case "tools/call": {
        const name = rpc.params?.name as string;
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const result = await callTool(new URL(req.url).origin, name, args, identity.email);
          return NextResponse.json(ok(rpc.id, result));
        } catch (e) {
          // Tool errors are reported in-band (isError) per MCP spec, not as RPC errors.
          return NextResponse.json(ok(rpc.id, { content: [{ type: "text", text: (e as Error).message }], isError: true }));
        }
      }
      default:
        return NextResponse.json(err(rpc.id, -32601, `method not found: ${rpc.method}`), { status: 404 });
    }
  } catch (e) {
    return NextResponse.json(err(rpc.id, -32603, (e as Error).message), { status: 500 });
  }
}

// Client of the WhatsApp sender service (apps/whatsapp, internal :4300). The API is the only
// caller: it checks the user, the role and that the chat is one of the user's saved chats, and
// always names the signed-in account — every account sends from its own linked number.

import { normalizeUiPrefs, normalizeWhatsAppTarget } from "@alarm/core";
import { HttpError } from "../common/http.js";

const URL_BASE = (process.env.WHATSAPP_URL || "http://127.0.0.1:4300").replace(/\/$/, "");
const TOKEN = process.env.WHATSAPP_TOKEN || process.env.NEXTAUTH_SECRET || "";

export interface SenderStatus {
  /** "offline" = the sender service does not answer. */
  state: "starting" | "qr" | "connected" | "disconnected" | "offline";
  qr: string | null;
  me: { phone: string; name: string | null } | null;
  error: string | null;
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  return fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { "X-Internal-Token": TOKEN, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const q = (userId: number, extra: Record<string, string> = {}) =>
  "?" + new URLSearchParams({ user: String(userId), ...extra });

/**
 * The account's link state. `start`: show a QR when no number is linked (the settings page);
 * `adopt`: take over the single session of the first version (super admin).
 */
export async function senderStatus(
  userId: number,
  opts: { start?: boolean; adopt?: boolean } = {},
): Promise<SenderStatus> {
  try {
    const extra: Record<string, string> = {};
    if (opts.start) extra.start = "1";
    if (opts.adopt) extra.adopt = "1";
    const res = await call(`/status${q(userId, extra)}`, {}, 3000);
    if (!res.ok) throw new Error(`sender answered ${res.status}`);
    return (await res.json()) as SenderStatus;
  } catch (e) {
    return { state: "offline", qr: null, me: null, error: (e as Error).message };
  }
}

export async function senderLogout(userId: number): Promise<void> {
  const res = await call(`/logout${q(userId)}`, { method: "POST" }).catch(() => {
    throw new HttpError(503, "The WhatsApp sender is not running");
  });
  if (!res.ok) throw new HttpError(res.status, ((await res.json()) as { error: string }).error);
}

/** Sends through the service; the service resolves the chat and pauses between messages. */
export async function senderSend(
  userId: number,
  body: {
    chat: string;
    text?: string;
    images?: { name: string; data: string }[];
  },
): Promise<{ chat: string; sent: number }> {
  // ~1.5 s per message plus the upload — allow a long send
  const timeout = 30_000 + 5_000 * ((body.images?.length ?? 0) + (body.text ? 1 : 0));
  const res = await call(
    `/send${q(userId)}`,
    { method: "POST", body: JSON.stringify(body) },
    timeout,
  ).catch((e: Error) => {
    throw new HttpError(503, `The WhatsApp sender is not running (${e.message})`);
  });
  const data = (await res.json()) as { chat: string; sent: number } | { error: string };
  if (!res.ok || "error" in data)
    throw new HttpError(
      res.status === 400 ? 400 : 502,
      "error" in data ? data.error : "send failed",
    );
  return data;
}

/**
 * The chats this user saved (Export image of /alarms and of the hourly report: all-images +
 * per-office; Send panel: its chat), in
 * stored form. Sending is allowed only to these, so the sender cannot be pointed anywhere else.
 */
export function savedChats(uiPrefs: unknown): Set<string> {
  const p = normalizeUiPrefs(uiPrefs);
  return new Set(
    [
      p.alarms.sendChat,
      p.alarms.image.shareAll,
      ...Object.values(p.alarms.image.shareOffices),
      p.hourlyShare.all,
      ...Object.values(p.hourlyShare.offices),
    ]
      .map(normalizeWhatsAppTarget)
      .filter(Boolean),
  );
}

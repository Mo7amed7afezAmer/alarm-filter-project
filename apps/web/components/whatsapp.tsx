"use client";

// The signed-in user's own WhatsApp sender (Settings → WhatsApp sender) as seen from the pages:
// is their number linked, and one send call. Every WhatsApp button / setting on the pages shows
// only while it is linked (user request 2026-10-29); viewers never have one.

import { useEffect, useState } from "react";

export interface WhatsAppStatus {
  state: "starting" | "qr" | "connected" | "disconnected" | "offline";
  qr: string | null;
  me: { phone: string; name: string | null } | null;
  error: string | null;
  /** Operator or higher (may link a number and send). */
  canSend: boolean;
}

/** One status request shared by every component of the page, refreshed after a minute. */
let cache: { at: number; promise: Promise<WhatsAppStatus | null> } | null = null;
const TTL = 60_000;

function loadStatus(): Promise<WhatsAppStatus | null> {
  if (!cache || Date.now() - cache.at > TTL)
    cache = {
      at: Date.now(),
      promise: fetch("/api/whatsapp/status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { data: WhatsAppStatus } | null) => b?.data ?? null)
        .catch(() => null),
    };
  return cache.promise;
}

/** Forget the shared status (after linking / logging out on the settings page). */
export function resetWhatsAppStatus() {
  cache = null;
}

/** `ready` = this user's own number is linked and connected. */
export function useWhatsAppSender(): { ready: boolean; status: WhatsAppStatus | null } {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStatus().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);
  return { ready: status?.state === "connected" && status.canSend, status };
}

async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Posts text and / or PNG images to one saved chat; resolves with the chat name WhatsApp gave. */
export async function sendViaWhatsApp(
  chat: string,
  content: { text?: string; images?: File[] },
): Promise<{ chat: string; sent: number }> {
  const images = await Promise.all(
    (content.images ?? []).map(async (f) => ({ name: f.name, data: await base64(f) })),
  );
  const res = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat, text: content.text, images }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Send failed (${res.status})`);
  return body.data;
}

// Pure part of the WhatsApp sender: which chat a saved setting names, and the checks on a send
// request (limits, image type) before anything goes out.

import { whatsappTarget } from "@alarm/core";

/** At most this many images per send request. */
export const MAX_IMAGES = 30;
/** Bytes per image (the page draws PNGs of ~100–400 KB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Characters of text per message. */
export const MAX_TEXT = 4000;
/** Pause between two messages to one chat, so a burst does not look like spam. */
export const PAUSE_MS = 1500;

export type ChatRef =
  { kind: "phone"; jid: string; phone: string } | { kind: "group"; code: string };

/** A saved number / group link → what to send to; null when it is neither. */
export function chatRef(chat: string): ChatRef | null {
  const t = whatsappTarget(chat);
  if (!t) return null;
  return t.kind === "phone"
    ? { kind: "phone", phone: t.phone, jid: `${t.phone}@s.whatsapp.net` }
    : { kind: "group", code: t.code };
}

export interface SendImage {
  name: string;
  /** PNG bytes, base64. */
  data: string;
}

export interface SendRequest {
  chat: string;
  text?: string;
  images?: SendImage[];
}

export type Outgoing =
  { kind: "text"; text: string } | { kind: "image"; name: string; png: Buffer };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Checks a request and turns it into the messages to send (text first, then the images). */
export function planSend(
  body: unknown,
): { ok: true; chat: ChatRef; messages: Outgoing[] } | { ok: false; error: string } {
  const r = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const chat = typeof r.chat === "string" ? chatRef(r.chat) : null;
  if (!chat) return { ok: false, error: "chat must be a WhatsApp number or group link" };
  const messages: Outgoing[] = [];
  if (r.text !== undefined) {
    if (typeof r.text !== "string") return { ok: false, error: "text must be a string" };
    if (r.text.length > MAX_TEXT)
      return { ok: false, error: `text is over ${MAX_TEXT} characters` };
    if (r.text.trim()) messages.push({ kind: "text", text: r.text });
  }
  const images: unknown[] = Array.isArray(r.images) ? r.images : [];
  if (r.images !== undefined && !Array.isArray(r.images))
    return { ok: false, error: "images must be a list" };
  if (images.length > MAX_IMAGES) return { ok: false, error: `at most ${MAX_IMAGES} images` };
  for (const [i, img] of images.entries()) {
    const o = img && typeof img === "object" ? (img as Record<string, unknown>) : {};
    if (typeof o.data !== "string") return { ok: false, error: `image ${i + 1} has no data` };
    const png = Buffer.from(o.data, "base64");
    if (png.length > MAX_IMAGE_BYTES) return { ok: false, error: `image ${i + 1} is too large` };
    if (!png.subarray(0, 8).equals(PNG)) return { ok: false, error: `image ${i + 1} is not a PNG` };
    messages.push({
      kind: "image",
      name: typeof o.name === "string" ? o.name : `image-${i + 1}.png`,
      png,
    });
  }
  if (!messages.length) return { ok: false, error: "nothing to send" };
  return { ok: true, chat, messages };
}

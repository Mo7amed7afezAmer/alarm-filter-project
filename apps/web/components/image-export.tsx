"use client";

// Tables drawn as PNG images for sharing on WhatsApp — shared by the hourly report and the
// active alarms page. `drawTable` paints one page on a <canvas>; `ImageExportDialog` shows the
// pages with Download and Copy (secure context only), and — only while the user's own WhatsApp
// number is linked (Settings → WhatsApp sender) — Send, which posts every saved chat its images.

import { Check, Copy, Download, Loader2, MessageCircle, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { sendViaWhatsApp, useWhatsAppSender } from "@/components/whatsapp";

const FONT = `"Segoe UI", Roboto, Arial, sans-serif`;
const SIZE = 13;
const ROW_H = 24;
const PAD_X = 8;
const MAX_COL_W = 320;
const SCALE = 2;

/** One table row: the text and the background colour (hex without "#", null = white) per cell. */
export interface ImageRow {
  text: string[];
  fill: (string | null)[];
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

/** Column widths over ALL rows, so the pages of one export line up. */
export function columnWidths(headers: string[], rows: ImageRow[]): number[] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return headers.map((h, i) => {
    ctx.font = `bold ${SIZE}px ${FONT}`;
    let w = ctx.measureText(h).width;
    ctx.font = `${SIZE}px ${FONT}`;
    for (const r of rows) w = Math.max(w, ctx.measureText(r.text[i] ?? "").width);
    return Math.ceil(Math.min(w, MAX_COL_W) + 2 * PAD_X);
  });
}

/** One page of rows → PNG blob. */
export function drawTable(opts: {
  rows: ImageRow[];
  headers: string[];
  widths: number[];
  title: string;
  subtitle: string;
  footer: string;
  /** Column indexes whose text is centred (e.g. ✓ marks). */
  center?: number[];
}): Promise<Blob> {
  const { rows, headers, widths, title, subtitle, footer, center = [] } = opts;
  const tableW = widths.reduce((a, b) => a + b, 0);
  const W = Math.max(tableW + 2, 480);
  const titleH = subtitle ? 56 : 36;
  const H = titleH + ROW_H * (rows.length + 1) + 28;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  const text = (s: string, i: number, x: number, y: number) => {
    const t = fit(ctx, s, widths[i]! - 2 * PAD_X);
    if (center.includes(i)) {
      ctx.textAlign = "center";
      ctx.fillText(t, x + widths[i]! / 2, y);
      ctx.textAlign = "left";
    } else ctx.fillText(t, x + PAD_X, y);
  };

  // title
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(fit(ctx, title, W - 2 * PAD_X), PAD_X, 18);
  if (subtitle) {
    ctx.fillStyle = "#475569";
    ctx.font = `${SIZE - 1}px ${FONT}`;
    ctx.fillText(fit(ctx, subtitle, W - 2 * PAD_X), PAD_X, 40);
  }

  // header
  let y = titleH;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(1, y, tableW, ROW_H);
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${SIZE}px ${FONT}`;
  let x = 1;
  headers.forEach((h, i) => {
    text(h, i, x, y + ROW_H / 2);
    x += widths[i]!;
  });

  // rows
  ctx.font = `${SIZE}px ${FONT}`;
  for (const r of rows) {
    y += ROW_H;
    x = 1;
    headers.forEach((_, i) => {
      const color = r.fill[i];
      ctx.fillStyle = color ? `#${color}` : "#ffffff";
      ctx.fillRect(x, y, widths[i]!, ROW_H);
      ctx.fillStyle = "#0f172a";
      text(r.text[i] ?? "", i, x, y + ROW_H / 2);
      x += widths[i]!;
    });
  }

  // grid
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 0.5;
  const top = titleH;
  const bottom = titleH + ROW_H * (rows.length + 1);
  for (let i = 0; i <= rows.length + 1; i++) {
    ctx.beginPath();
    ctx.moveTo(1, top + i * ROW_H);
    ctx.lineTo(1 + tableW, top + i * ROW_H);
    ctx.stroke();
  }
  x = 1;
  for (let i = 0; i <= widths.length; i++) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    x += widths[i] ?? 0;
  }

  ctx.fillStyle = "#64748b";
  ctx.font = `${SIZE - 2}px ${FONT}`;
  ctx.fillText(footer, PAD_X, bottom + 14);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image could not be created"))),
      "image/png",
    ),
  );
}

/** "Down sites" → "down-sites" (file name part). */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Opens a WhatsApp link: the phone app (whatsapp://) in place, a web link in ONE named tab that
 * every later Send reuses (user 2026-10-28: each Send opened another WhatsApp Web tab).
 */
export function openWhatsApp(url: string) {
  if (url.startsWith("whatsapp:")) {
    window.location.href = url;
    return;
  }
  // no "noopener": with it Chrome ignores the name and always opens a new tab
  const w = window.open(url, "alarm-filter-whatsapp");
  if (w) {
    w.opener = null;
    w.focus();
  }
}

export interface ImagePage {
  file: File;
  url: string;
}

/** A chat that gets some of the images (e.g. an office's group). */
export interface ShareTarget {
  /** E.g. "All images", "Tanta". */
  label: string;
  /** Number (digits with country code) or group invite link. */
  chat: string;
  pages: ImagePage[];
}

/** The export window: options row (`controls`), Send / Download, then the image previews. */
export function ImageExportDialog({
  title,
  controls,
  summary,
  pages,
  busy,
  msg,
  onMsg,
  onClose,
  toolbar,
  targets = [],
}: {
  title: string;
  controls: ReactNode;
  /** E.g. "120 rows → 3 images". */
  summary: ReactNode;
  pages: ImagePage[];
  busy: boolean;
  msg: string | null;
  onMsg: (m: string) => void;
  onClose: () => void;
  /** Extra buttons at the right end of the header (e.g. a settings gear). */
  toolbar?: ReactNode;
  /** Chats "Send" delivers to, in order (the user's share settings). */
  targets?: ShareTarget[];
}) {
  // WhatsApp only while this user's own number is linked (Settings → WhatsApp sender)
  const { ready: linked } = useWhatsAppSender();
  /** Sending per target label: "sending", "sent" or the error. */
  const [state, setState] = useState<Record<string, string>>({});
  const [sendingAll, setSendingAll] = useState(false);
  const canCopy =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!navigator.clipboard &&
    "ClipboardItem" in window;
  const ready = targets.filter((t) => t.pages.length);

  const download = () => {
    pages.forEach((p, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = p.url;
        a.download = p.file.name;
        a.click();
      }, i * 300),
    );
  };
  /** Every chat in turn, each with its own images, from the linked number. */
  const sendAll = async () => {
    setSendingAll(true);
    setState({});
    let ok = 0;
    let images = 0;
    for (const t of ready) {
      setState((s) => ({ ...s, [t.label]: "sending" }));
      try {
        await sendViaWhatsApp(t.chat, { images: t.pages.map((p) => p.file) });
        ok++;
        images += t.pages.length;
        setState((s) => ({ ...s, [t.label]: "sent" }));
      } catch (e) {
        setState((s) => ({ ...s, [t.label]: (e as Error).message }));
      }
    }
    setSendingAll(false);
    onMsg(
      ok === ready.length
        ? `Sent ${images} image${images === 1 ? "" : "s"} to ${ok} chat${ok === 1 ? "" : "s"}`
        : `Sent to ${ok} of ${ready.length} chats — see the failed ones below`,
    );
  };
  const copy = async (p: ImagePage) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": p.file })]);
      onMsg("Image copied");
    } catch (e) {
      onMsg(`Copy failed: ${(e as Error).message}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-full max-w-5xl rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <div className="flex items-center gap-1">
            {toolbar}
            <button
              aria-label="Close"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-3 text-sm">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">{controls}</div>
          {/* pt-5 = the label line above the select boxes, so the buttons line up with them */}
          <div className="ml-auto flex flex-wrap items-center gap-2 pt-5">
            {linked && (
              <Button
                size="sm"
                className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => void sendAll()}
                disabled={busy || sendingAll || !ready.length}
                title={
                  ready.length
                    ? "Your WhatsApp number posts the images to every saved chat"
                    : "Save a chat first: ⚙ → Share settings"
                }
              >
                {sendingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                {sendingAll
                  ? "Sending…"
                  : Object.keys(state).length
                    ? "Send again"
                    : ready.length > 1
                      ? `Send to ${ready.length} chats`
                      : `Send${pages.length > 1 ? ` ${pages.length} images` : ""}`}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={download}
              disabled={busy || !pages.length}
            >
              <Download className="h-4 w-4" />
              Download{pages.length > 1 ? ` ${pages.length} images` : ""}
            </Button>
          </div>
        </div>
        {linked && !busy && Object.keys(state).length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-2 text-xs">
            {ready.map((t) => {
              const st = state[t.label];
              const failed = st && st !== "sending" && st !== "sent";
              return (
                <span
                  key={t.label}
                  title={failed ? st : t.chat}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 " +
                    (st === "sent"
                      ? "bg-emerald-100 text-emerald-800"
                      : failed
                        ? "bg-red-100 text-red-800"
                        : "bg-slate-100 text-slate-700")
                  }
                >
                  {st === "sent" ? (
                    <Check className="h-3 w-3" />
                  ) : st === "sending" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : failed ? (
                    <X className="h-3 w-3" />
                  ) : (
                    <MessageCircle className="h-3 w-3" />
                  )}
                  {t.label} · {t.pages.length}
                  {failed && `: ${st}`}
                </span>
              );
            })}
          </div>
        )}
        <div className="space-y-1 px-4 pt-2 text-xs text-slate-500">
          {summary}
          {linked && (
            <span>
              {" "}
              ·{" "}
              {ready.length
                ? "Send posts the images from your WhatsApp number."
                : "Save a chat in ⚙ → Share settings to send."}
            </span>
          )}
          {msg && <div className="font-medium text-slate-800">{msg}</div>}
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-auto p-4">
          {busy && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Drawing…
            </div>
          )}
          {!busy &&
            pages.map((p) => (
              <figure key={p.url} className="space-y-1">
                <figcaption className="flex items-center gap-2 text-xs text-slate-500">
                  {p.file.name}
                  {canCopy && (
                    <button
                      className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                      onClick={() => void copy(p)}
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  )}
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.file.name}
                  className="max-w-full rounded border border-slate-200"
                />
              </figure>
            ))}
        </div>
      </div>
    </div>
  );
}

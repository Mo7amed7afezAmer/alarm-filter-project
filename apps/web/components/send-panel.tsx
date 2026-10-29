"use client";

// Floating "Send" button of /alarms and /cleared (bottom-right, like a WhatsApp chat button).
// It opens a window in the middle of the screen with two tabs that each build a short WhatsApp
// message. The message area, top to bottom: the office name, bullets for the teams ("team in
// way to LNG"), a notes box, then the mail subjects added from the list below it:
//   Mail   — the latest active alarm mails
//   Update — the latest Clear mails (last 24 h)
// (search, click a subject to add it). Copy puts the message on the clipboard; Share opens the
// saved chat (number → text pre-filled, group link → copied first, then the group opens) or the
// chat list. The chat is saved per user (uiPrefs.alarms.sendChat); each tab's message is a
// draft kept in this browser.

import {
  hasUpdateText,
  normalizeWhatsAppTarget,
  officeTitle,
  updateText,
  whatsappTarget,
  whatsappTextUrl,
  type UpdateParts,
} from "@alarm/core";
import { Check, Copy, MessageCircle, Plus, Search, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MailAlarm } from "@/components/alarm-mail";
import { useAppConfig } from "@/components/app-config";
import { openWhatsApp } from "@/components/image-export";
import { useUiPrefs } from "@/components/ui-prefs";
import { sendViaWhatsApp, useWhatsAppSender } from "@/components/whatsapp";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

type Tab = "mail" | "update";

const TABS: {
  id: Tab;
  label: string;
  added: string;
  /** Mark of each mail line in the WhatsApp message. */
  icon: string;
  source: string;
  empty: string;
}[] = [
  {
    id: "mail",
    icon: "🔴",
    label: "Mail",
    added: "Alarms",
    source: "Latest alarm mails",
    empty: "No active alarms",
  },
  {
    id: "update",
    icon: "✅",
    label: "Update",
    added: "Clears",
    source: "Latest clears",
    empty: "No clears in the last 24 h",
  },
];

/** Pages that show the button. */
const PAGES = ["/alarms", "/cleared"];
/** Accounts that get the button: office admins and operators (user request 2026-10-29). */
const SENDERS = ["ADMIN", "OPERATOR"];

const EMPTY: UpdateParts = { bullets: [""], notes: "", mails: [] };
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function loadDraft(tab: Tab): UpdateParts {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(`send.${tab}`) ?? "null");
    // first version: a plain list of bullets
    if (Array.isArray(v)) return { ...EMPTY, bullets: strings(v).length ? strings(v) : [""] };
    if (!v || typeof v !== "object") return EMPTY;
    const r = v as Record<string, unknown>;
    const bullets = strings(r.bullets);
    return {
      bullets: bullets.length ? bullets : [""],
      notes: typeof r.notes === "string" ? r.notes : "",
      mails: strings(r.mails),
    };
  } catch {
    return EMPTY;
  }
}
function saveDraft(tab: Tab, parts: UpdateParts) {
  try {
    localStorage.setItem(`send.${tab}`, JSON.stringify(parts));
  } catch {
    // private window / blocked storage: the draft just is not kept
  }
}

/** Clipboard text, also on plain http (no secure context) through a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

/** The mail subject of an alarm (its Clear mail for the Update tab). */
function subjectOf(a: MailAlarm, clear: boolean): string {
  if (clear && a.clearMessage?.subject) return a.clearMessage.subject;
  const s = a.rawMessage?.subject ?? `${a.alarmName} on #${a.site}#`;
  return clear && !/^CLEARED_/i.test(s) ? `CLEARED_${s}` : s;
}

/** Latest mails of the tab, loaded when the tab opens. */
function useMails(tab: Tab) {
  const [items, setItems] = useState<{ subject: string; time: string; category: string }[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    const clear = tab === "update";
    fetch(`/api/alarms/${clear ? "cleared" : "active"}?page=1&pageSize=500`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load the mails (${res.status})`);
        const data = (await res.json()) as { items: (MailAlarm & { clearTime?: string })[] };
        if (cancelled) return;
        setItems(
          data.items.map((a) => ({
            subject: subjectOf(a, clear),
            category: a.category,
            time:
              (clear ? (a.clearMessage?.receivedAt ?? a.clearTime) : a.rawMessage?.receivedAt) ??
              a.alarmTime,
          })),
        );
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [tab]);
  return { items, error };
}

const SECTION = "text-xs font-medium uppercase tracking-wide text-slate-500";

/** Mails listed before a search (a search shows every match). */
const LATEST = 20;

const CATS = [
  { id: "", label: "All categories" },
  { id: "DOWN", label: "Down" },
  { id: "POWER", label: "Power" },
  { id: "OTHER", label: "Other" },
];

function Composer({ tab, onMsg }: { tab: Tab; onMsg: (m: string) => void }) {
  const { office, timeZone } = useAppConfig();
  const { prefs, update } = useUiPrefs();
  const info = TABS.find((t) => t.id === tab)!;
  const title = officeTitle(office);
  const [parts, setParts] = useState<UpdateParts>(() => loadDraft(tab));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [chat, setChat] = useState(prefs.alarms.sendChat);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);
  const { items, error } = useMails(tab);
  const { bullets, notes, mails } = parts;

  useEffect(() => saveDraft(tab, parts), [tab, parts]);
  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });

  const setBullets = (next: string[]) =>
    setParts((p) => ({ ...p, bullets: next.length ? next : [""] }));
  const addMail = (s: string) =>
    setParts((p) => (p.mails.includes(s) ? p : { ...p, mails: [...p.mails, s] }));
  const removeMail = (s: string) =>
    setParts((p) => ({ ...p, mails: p.mails.filter((m) => m !== s) }));
  const saveChat = () => {
    const v = normalizeWhatsAppTarget(chat);
    setChat(v || chat);
    if (v !== prefs.alarms.sendChat)
      update((p) => ({ ...p, alarms: { ...p.alarms, sendChat: v } }));
  };

  // minutes are enough in a chat message
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const text = updateText(title, stamp, parts, {
    mails: tab === "update" ? "Cleared" : "Alarms",
    icon: info.icon,
  });
  const hasText = hasUpdateText(parts);
  const target = whatsappTarget(prefs.alarms.sendChat);

  const copy = async () =>
    onMsg((await copyText(text)) ? "Copied — paste it in the chat" : "Copy failed");
  // a linked sender number posts the message itself (only to the saved chat)
  const { ready: auto } = useWhatsAppSender();
  const [sending, setSending] = useState(false);
  const share = async () => {
    if (auto && target) {
      setSending(true);
      try {
        const r = await sendViaWhatsApp(prefs.alarms.sendChat, { text });
        onMsg(`Sent to ${r.chat}`);
      } catch (e) {
        onMsg(`Not sent: ${(e as Error).message}`);
      } finally {
        setSending(false);
      }
      return;
    }
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (!target && touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
      } catch {
        // cancelled
      }
      return;
    }
    if (target?.kind === "group") {
      const ok = await copyText(text);
      onMsg(ok ? "Copied — paste it in the group (Ctrl+V)" : "Copy failed — use Copy first");
    } else onMsg("WhatsApp opened with the message typed in");
    openWhatsApp(whatsappTextUrl(prefs.alarms.sendChat, text, touch));
  };

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter(
      (m) =>
        (!cat || m.category === cat) && words.every((w) => m.subject.toLowerCase().includes(w)),
    );
  }, [items, q, cat]);
  // the newest LATEST only; a search shows every match
  const searching = !!q.trim();
  const listed = searching ? shown : shown.slice(0, LATEST);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* the message: office · team bullets · notes · added mails */}
        <div className="space-y-3 rounded-lg bg-slate-100 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-lg font-semibold text-slate-900">{title}</h3>
            {hasText && (
              <button
                type="button"
                className="shrink-0 text-xs text-slate-500 hover:text-slate-900"
                onClick={() => setParts(EMPTY)}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <div className={SECTION}>Teams</div>
            <ul className="space-y-1.5">
              {bullets.map((line, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-slate-500">•</span>
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    value={line}
                    aria-label={`Team ${i + 1}`}
                    placeholder={i === 0 ? "e.g. team in way to LNG" : "Next team"}
                    onChange={(e) =>
                      setBullets(bullets.map((l, j) => (j === i ? e.target.value : l)))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNext.current = i + 1;
                        setBullets([...bullets.slice(0, i + 1), "", ...bullets.slice(i + 1)]);
                      } else if (e.key === "Backspace" && !line && bullets.length > 1) {
                        e.preventDefault();
                        focusNext.current = Math.max(0, i - 1);
                        setBullets(bullets.filter((_, j) => j !== i));
                      }
                    }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-white px-2 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={`Remove team ${i + 1}`}
                    onClick={() => setBullets(bullets.filter((_, j) => j !== i))}
                    className="rounded-sm p-0.5 text-slate-400 hover:text-slate-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              onClick={() => {
                focusNext.current = bullets.length;
                setBullets([...bullets, ""]);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add team
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className={SECTION}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setParts((p) => ({ ...p, notes: e.target.value }))}
              rows={3}
              placeholder="Any other note"
              className="block w-full resize-y rounded-md border border-input bg-white px-2 py-1.5 text-sm"
            />
          </label>

          <div className="space-y-1.5">
            <div className={SECTION}>{info.added}</div>
            {mails.length === 0 ? (
              <p className="text-xs text-slate-500">Add from &quot;{info.source}&quot; below.</p>
            ) : (
              <ul className="space-y-1">
                {mails.map((m) => (
                  <li key={m} className="flex items-start gap-2 rounded-md bg-white px-2 py-1.5">
                    <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-900">
                      {m}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => removeMail(m)}
                      className="rounded-sm p-0.5 text-slate-400 hover:text-slate-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* latest mails to add */}
        <div className="space-y-2">
          <div className={SECTION}>{info.source}</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block min-w-0 flex-1 basis-48">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search alarm, site or code"
                className="h-8 w-full rounded-md border border-input bg-white pl-8 pr-2 text-sm"
              />
            </label>
            <select
              aria-label="Category"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="h-8 rounded-md border border-input bg-white px-2 text-sm text-slate-900"
            >
              {CATS.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.label} (${
                    c.id
                      ? (items ?? []).filter((m) => m.category === c.id).length
                      : (items?.length ?? 0)
                  })`}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p className="text-xs text-red-700">{error}</p>
          ) : !items ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : !shown.length ? (
            <p className="text-xs text-slate-500">{items.length ? "No match" : info.empty}</p>
          ) : (
            <ul className="space-y-1">
              {listed.map((m, i) => {
                const added = mails.includes(m.subject);
                return (
                  <li key={`${m.subject}-${i}`}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addMail(m.subject)}
                      title={added ? "Already in the message" : "Add to the message"}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 disabled:opacity-60"
                    >
                      {added ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                      ) : (
                        <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-xs text-slate-900">
                          {m.subject}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {formatDateTime(new Date(m.time), timeZone)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {items && !searching && shown.length > LATEST && (
            <p className="text-xs text-slate-500">
              Newest {LATEST} of {shown.length} — search to see the others.
            </p>
          )}
        </div>
      </div>

      {/* chat + actions */}
      <div className="space-y-2 border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">Send to</span>
            <input
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              onBlur={saveChat}
              onKeyDown={(e) => e.key === "Enter" && saveChat()}
              placeholder="WhatsApp number or group link (empty = pick a chat)"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-white px-2 text-sm text-slate-900"
            />
          </label>
          <Button size="sm" variant="outline" className="h-9" disabled={!hasText} onClick={copy}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!hasText || sending}
            onClick={() => void share()}
            title={
              auto && target
                ? "The linked WhatsApp number sends the message"
                : target?.kind === "group"
                  ? "Copies the message and opens the group"
                  : target
                    ? `Opens the chat with +${target.phone}`
                    : "Opens WhatsApp — pick the chat"
            }
          >
            <Send className="h-4 w-4" /> Share
          </Button>
        </div>
        {chat.trim() && !whatsappTarget(chat) && (
          <p className="text-xs text-red-700">Not a number or group link</p>
        )}
      </div>
    </div>
  );
}

export function SendButton() {
  const pathname = usePathname();
  const { role } = useAppConfig();
  // only while the user's own WhatsApp number is linked (user request 2026-10-29)
  const { ready: linked } = useWhatsAppSender();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("update");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!SENDERS.includes(role) || !linked) return null;
  if (!PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Send"
            className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[90vh]"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 pt-3">
              <div className="flex gap-1" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={
                      "border-b-2 px-3 pb-2.5 text-sm font-medium " +
                      (tab === t.id
                        ? "border-brand text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-900")
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="mb-2 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* one composer per tab, so each keeps its own draft */}
            <Composer key={tab} tab={tab} onMsg={setMsg} />
            {msg && (
              <div className="border-t border-slate-200 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-800">
                {msg}
              </div>
            )}
          </div>
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Send"
          className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 sm:right-6"
        >
          <MessageCircle className="h-5 w-5" />
          Send
        </button>
      )}
    </>
  );
}

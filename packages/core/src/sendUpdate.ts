// "Send" panel of /alarms and /cleared (user request 2026-10-28): a short WhatsApp message —
// office name on top, the team bullets ("team in way to LNG"), free notes, then the mail
// subjects picked from the list (Clear mails in the Update tab). Pure part: the message text
// and the WhatsApp link that pre-fills it.

import { shortSite, whatsappTarget, whatsappUrl, type WhatsAppTarget } from "./alarmImage.js";

export interface UpdateParts {
  /** Team points, one bullet each. */
  bullets: readonly string[];
  /** Free text under the bullets (kept as typed, line breaks included). */
  notes: string;
  /** Mail subjects, one line each. */
  mails: readonly string[];
}

export interface UpdateLabels {
  /** Heading of the mail lines, e.g. "Cleared" (the count is added). */
  mails: string;
  /** Mark in front of each mail line, e.g. "✅". */
  icon: string;
}

const DEFAULT_LABELS: UpdateLabels = { mails: "Cleared", icon: "✅" };

/**
 * Left-to-right mark. WhatsApp sets each line's direction from its first strong letter, and a
 * line that starts with "•", "-" or "*" takes the phone's direction — on an Arabic phone the
 * English lines came out right-aligned (user screenshot 2026-10-28). The mark makes every line
 * start left-to-right.
 */
const LRM = "‎";

/** Vendor prefixes of the alarm names ("S_D_N_BTS DOWN" → "BTS DOWN"). */
const NAME_PREFIX = /^(?:S_D_N_|D_S_)/i;

/**
 * A mail subject as one readable line: "NE3SWS AGENT NOT RESPONDING TO REQUESTS —
 * BH-MALQA_4244DE" (no CLEARED_ / vendor prefix, short site, no time). Other text stays as is.
 */
export function mailLine(subject: string): string {
  const s = subject.replace(/\s+/g, " ").trim();
  const m = /^(?:CLEARED_)?(.+?) on #([^#]+)#/i.exec(s);
  if (!m) return s;
  const name = m[1]!.split(";")[0]!.replace(NAME_PREFIX, "").trim();
  return `${name} — ${shortSite(m[2]!.trim())}`;
}

/**
 * The message, each part only when it has text:
 *
 *   *Kafr ElDawar* · 28 Oct, 20:01
 *
 *   *Teams*
 *   - team on way to rashid 1
 *
 *   check matmir7
 *
 *   *Cleared (1)*
 *   ✅ NE3SWS AGENT NOT RESPONDING TO REQUESTS — BH-MALQA_4244DE
 *
 * "- " is WhatsApp's list syntax; every line starts with a left-to-right mark (see LRM).
 */
export function updateText(
  title: string,
  time: string,
  parts: UpdateParts,
  labels: UpdateLabels = DEFAULT_LABELS,
): string {
  const head = [title.trim() && `*${title.trim()}*`, time].filter(Boolean).join(" · ");
  const bullets = parts.bullets.map((l) => l.trim()).filter(Boolean);
  const notes = parts.notes
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  const mails = parts.mails.map((l) => l.trim()).filter(Boolean);
  const blocks = [
    head ? [head] : [],
    bullets.length ? ["*Teams*", ...bullets.map((l) => `- ${l}`)] : [],
    notes ? notes.split("\n") : [],
    mails.length
      ? [
          `*${labels.mails} (${mails.length})*`,
          ...mails.map((s) => `${labels.icon} ${mailLine(s)}`),
        ]
      : [],
  ].filter((b) => b.length);
  return blocks.map((b) => b.map((l) => (l ? LRM + l : l)).join("\n")).join("\n\n");
}

/** True when the message has something besides the title. */
export function hasUpdateText(parts: UpdateParts): boolean {
  return [...parts.bullets, parts.notes, ...parts.mails].some((l) => l.trim());
}

/**
 * The link that opens WhatsApp with `text` typed in: a number's chat, or the chat list when
 * there is no target. A group invite link cannot carry text — the caller copies it first.
 */
export function whatsappTextUrl(chat: string, text: string, mobile: boolean): string {
  const target: WhatsAppTarget | null = whatsappTarget(chat);
  if (target?.kind === "group") return whatsappUrl(target, mobile);
  const enc = encodeURIComponent(text);
  if (!target)
    return mobile ? `whatsapp://send?text=${enc}` : `https://web.whatsapp.com/send?text=${enc}`;
  return `${whatsappUrl(target, mobile)}&text=${enc}`;
}

/** "DN/Kafr ElDawar" → "Kafr ElDawar"; a group "DN" stays; null → "All offices". */
export function officeTitle(office: string | null): string {
  if (office === null) return "All offices";
  return office.split("/").pop() || office;
}

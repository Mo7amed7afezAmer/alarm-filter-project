// Personal UI settings of one user (users.uiPrefs): theme and how the alarm tables look.
// Pure part — the API validates and stores it, the web pages read it.

import {
  DEFAULT_ALARM_IMAGE_PREFS,
  normalizeAlarmImagePrefs,
  normalizeWhatsAppTarget,
  type AlarmImagePrefs,
} from "./alarmImage.js";
import { DEFAULT_HOURLY_PREFS, normalizeHourlyPrefs, type HourlyPrefs } from "./hourly/output.js";

export const THEMES = ["blue", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** Alarm tables that have a column chooser. */
export const ALARM_TABLES = ["active", "cleared"] as const;
export type AlarmTable = (typeof ALARM_TABLES)[number];

/** Column ids of each alarm table (as used by the pages' ColumnDefs) with their labels. */
export const ALARM_COLUMNS: Record<
  AlarmTable,
  { id: string; label: string; required?: boolean }[]
> = {
  active: [
    { id: "category", label: "Category" },
    { id: "alarmName", label: "Alarm", required: true },
    { id: "site", label: "Site", required: true },
    { id: "cell", label: "Cell / device" },
    { id: "region", label: "Region" },
    { id: "nodality", label: "Nodality" },
    { id: "battery", label: "Battery" },
    { id: "phone", label: "Phone" },
    { id: "alarmTime", label: "Raised" },
    { id: "age", label: "Age" },
  ],
  cleared: [
    { id: "category", label: "Category" },
    { id: "alarmName", label: "Alarm", required: true },
    { id: "site", label: "Site", required: true },
    { id: "cell", label: "Cell / device" },
    { id: "nodality", label: "Nodality" },
    { id: "battery", label: "Battery" },
    { id: "phone", label: "Phone" },
    { id: "alarmTime", label: "Raised" },
    { id: "clearTime", label: "Cleared" },
    { id: "durationMin", label: "Duration" },
    { id: "clearType", label: "Clear type" },
  ],
};

/** How the Alarms / Cleared pages list alarms: table rows, or Gmail-style mail cards. */
export const ALARM_VIEWS = ["table", "mail"] as const;
export type AlarmView = (typeof ALARM_VIEWS)[number];

/** Parts of a mail card that can be switched on / off (the subject is always shown). */
export const MAIL_PARTS = [
  { id: "tags", label: "Tags", hint: "ALM / CLR and the site tags VIP, NODAL, BATT, GEN" },
  {
    id: "labels",
    label: "Other Gmail labels",
    hint: "The mail's own labels (office labels never show)",
  },
  {
    id: "age",
    label: "Age / duration",
    hint: "Top right: how long the alarm is active (or lasted)",
  },
  { id: "cellDevice", label: "Cell or device", hint: "The cell name, else the alarm device" },
  { id: "phone", label: "Call button", hint: "Guard phone from Site Master" },
  { id: "category", label: "Category badge", hint: "DOWN / POWER / OTHER next to the age" },
  { id: "received", label: "Mail time", hint: "When the mail arrived (n min ago)" },
  { id: "raised", label: "Raised time", hint: "The alarm time from the subject" },
] as const;
export type MailPart = (typeof MAIL_PARTS)[number]["id"];

export interface UiPrefs {
  theme: Theme;
  /** Grey border lines around cards, lists and tables (2026-10-27; default off = borderless
   *  look, user 2026-10-28). */
  borders: boolean;
  alarms: {
    view: AlarmView;
    /** VIP / Nodality / Battery as small icons next to the site instead of columns + badge. */
    siteInfoIcons: boolean;
    /** Rows with the same site code are shown once; clicking the row expands the others. */
    groupBySite: boolean;
    /** Mail view: alarms of the same site code fold into one card that opens (accordion). */
    mailGroupBySite: boolean;
    /** Column ids hidden per table (required columns are never hidden). */
    hiddenColumns: Record<AlarmTable, string[]>;
    /** Mail view: which parts of a card are shown. */
    mail: Record<MailPart, boolean>;
    /** "Export image" of the active alarms page (one row per site). */
    image: AlarmImagePrefs;
    /** "Send" panel: the WhatsApp number or group link the update goes to; "" = pick a chat. */
    sendChat: string;
  };
  /** Hourly reports: table, images, Excel and PDF (hourly/output.ts). */
  hourly: HourlyPrefs;
  /**
   * Where the hourly "Table as image" sends (user request 2026-10-29), per user like the alarm
   * image's share chats: every image to `all`, or each office's images to its own chat
   * (`offices`: Site Master office name, upper-case → number / group link).
   */
  hourlyShare: HourlyShare;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: "blue",
  borders: false,
  alarms: {
    view: "mail",
    siteInfoIcons: false,
    groupBySite: false,
    mailGroupBySite: false,
    hiddenColumns: { active: [], cleared: [] },
    // Like the Gmail list, plus age, cell / device and the call button (user, 2026-10-25).
    mail: {
      tags: true,
      labels: true,
      age: true,
      cellDevice: true,
      phone: true,
      category: false,
      received: false,
      raised: false,
    },
    image: DEFAULT_ALARM_IMAGE_PREFS,
    sendChat: "",
  },
  hourly: DEFAULT_HOURLY_PREFS,
  hourlyShare: { mode: "all", all: "", offices: {} },
};

/** Any stored / submitted value → a complete, valid UiPrefs (unknown keys and ids dropped). */
export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const r = obj(raw);
  const a = obj(r.alarms);
  const hidden = obj(a.hiddenColumns);
  const mail = obj(a.mail);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const d = DEFAULT_UI_PREFS.alarms;
  return {
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_UI_PREFS.theme,
    borders: bool(r.borders, DEFAULT_UI_PREFS.borders),
    alarms: {
      view: ALARM_VIEWS.includes(a.view as AlarmView) ? (a.view as AlarmView) : d.view,
      siteInfoIcons: bool(a.siteInfoIcons, d.siteInfoIcons),
      groupBySite: bool(a.groupBySite, d.groupBySite),
      mailGroupBySite: bool(a.mailGroupBySite, d.mailGroupBySite),
      hiddenColumns: Object.fromEntries(
        ALARM_TABLES.map((t) => {
          const allowed = new Set(ALARM_COLUMNS[t].filter((c) => !c.required).map((c) => c.id));
          const list = Array.isArray(hidden[t]) ? (hidden[t] as unknown[]) : [];
          return [t, [...new Set(list.filter((x): x is string => allowed.has(x as string)))]];
        }),
      ) as Record<AlarmTable, string[]>,
      mail: Object.fromEntries(
        MAIL_PARTS.map(({ id }) => [id, bool(mail[id], d.mail[id])]),
      ) as Record<MailPart, boolean>,
      image: normalizeAlarmImagePrefs(a.image),
      sendChat: typeof a.sendChat === "string" ? normalizeWhatsAppTarget(a.sendChat) : "",
    },
    hourly: normalizeHourlyPrefs(r.hourly),
    hourlyShare: normalizeHourlyShare(r.hourlyShare),
  };
}

export interface HourlyShare {
  mode: "all" | "office";
  all: string;
  offices: Record<string, string>;
}

export function normalizeHourlyShare(raw: unknown): HourlyShare {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const offices = r.offices && typeof r.offices === "object" ? r.offices : {};
  return {
    mode: r.mode === "office" ? "office" : "all",
    all: typeof r.all === "string" ? normalizeWhatsAppTarget(r.all) : "",
    offices: Object.fromEntries(
      Object.entries(offices)
        .filter(([k, v]) => k.trim() && typeof v === "string")
        .map(([k, v]) => [k.trim().toUpperCase(), normalizeWhatsAppTarget(v as string)] as const)
        .filter(([, v]) => v)
        .slice(0, 100),
    ),
  };
}

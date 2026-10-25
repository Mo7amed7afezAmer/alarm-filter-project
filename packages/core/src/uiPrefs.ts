// Personal UI settings of one user (users.uiPrefs): theme and how the alarm tables look.
// Pure part — the API validates and stores it, the web pages read it.

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
  };
  /** Hourly reports: table, images, Excel and PDF (hourly/output.ts). */
  hourly: HourlyPrefs;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: "blue",
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
  },
  hourly: DEFAULT_HOURLY_PREFS,
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
    },
    hourly: normalizeHourlyPrefs(r.hourly),
  };
}

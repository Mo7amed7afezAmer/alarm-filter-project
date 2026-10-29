// "Export image" of the active alarms page: one row per site (all its active alarms folded
// together), with a Down / Power / Other mark per category, optionally one table per office.
// Pure part — the web page draws the rows on a canvas.

import type { Category } from "./index.js";
import { siteTags } from "./siteFlags.js";

/** Columns of the image, in display order. */
export const ALARM_IMAGE_COLUMNS = [
  { id: "time", label: "Time" },
  { id: "site", label: "Site" },
  { id: "age", label: "Age" },
  { id: "down", label: "Down" },
  { id: "power", label: "Power" },
  { id: "other", label: "Other" },
  { id: "office", label: "Office" },
  { id: "vip", label: "VIP" },
  { id: "nodal", label: "Nodal" },
  { id: "alarms", label: "Alarms" },
  { id: "tags", label: "Tags" },
  { id: "phone", label: "Phone" },
] as const;
export type AlarmImageColumn = (typeof ALARM_IMAGE_COLUMNS)[number]["id"];

/** Default columns (user, 2026-10-26): time, site with its code, age, down, power. */
export const DEFAULT_ALARM_IMAGE_COLUMNS: AlarmImageColumn[] = [
  "time",
  "site",
  "age",
  "down",
  "power",
];

export const ALARM_IMAGE_ROWS = [25, 40, 60, 100] as const;

/** Row order of the image (user request 2026-10-26). */
export const ALARM_IMAGE_SORTS = [
  { id: "oldest", label: "Oldest first" },
  { id: "newest", label: "Newest first" },
  { id: "down", label: "Down first" },
  { id: "power", label: "Power first" },
  { id: "site", label: "Site name" },
] as const;
export type AlarmImageSort = (typeof ALARM_IMAGE_SORTS)[number]["id"];

export interface AlarmImagePrefs {
  /** Visible columns (always shown in ALARM_IMAGE_COLUMNS order). */
  columns: AlarmImageColumn[];
  /** One table (image set) per office instead of every office in one table. */
  byOffice: boolean;
  rowsPerImage: number;
  sort: AlarmImageSort;
  /** Fill of the Office cell per office name ("Kafr ElDawar" → "#bbf7d0"); none = white. */
  officeColors: Record<string, string>;
  /**
   * Where "Send" delivers ALL the images: a WhatsApp number (digits with country code) or a
   * group invite link (https://chat.whatsapp.com/…); "" = none. Was `whatsappPhone`.
   */
  shareAll: string;
  /** Per office name: the number or group link that gets that office's images. */
  shareOffices: Record<string, string>;
  /** "all": every image to the shareAll chat; "office": each office chat gets its own images. */
  shareMode: "all" | "office";
}

export const DEFAULT_ALARM_IMAGE_PREFS: AlarmImagePrefs = {
  columns: DEFAULT_ALARM_IMAGE_COLUMNS,
  byOffice: false,
  rowsPerImage: 40,
  sort: "oldest",
  officeColors: {},
  shareAll: "",
  shareOffices: {},
  shareMode: "all",
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A phone as typed → the digits WhatsApp wants (country code, no "+" or "00"): Egyptian local
 * mobiles "01xxxxxxxxx" get 20 in front. "" when it is too short to be a number.
 */
export function whatsappNumber(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `20${d.slice(1)}`;
  return d.length >= 8 && d.length <= 15 ? d : "";
}

export type WhatsAppTarget = { kind: "phone"; phone: string } | { kind: "group"; code: string };

const GROUP_LINK = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})\/?$/i;

/** A number or a group invite link as typed → the chat it names; null when it is neither. */
export function whatsappTarget(text: string): WhatsAppTarget | null {
  const t = text.trim();
  const group = GROUP_LINK.exec(t);
  if (group) return { kind: "group", code: group[1]! };
  if (/[a-z]/i.test(t)) return null;
  const phone = whatsappNumber(t);
  return phone ? { kind: "phone", phone } : null;
}

/** Stored form: digits for a number, "https://chat.whatsapp.com/<code>" for a group, "" invalid. */
export function normalizeWhatsAppTarget(text: string): string {
  const t = whatsappTarget(text);
  return !t ? "" : t.kind === "phone" ? t.phone : `https://chat.whatsapp.com/${t.code}`;
}

/**
 * The link that opens the chat: the phone app (`mobile`) or WhatsApp Web. A group opens through
 * its invite link (it shows the group when the account is already a member). null target = the
 * chat list.
 */
export function whatsappUrl(target: WhatsAppTarget | null, mobile: boolean): string {
  if (!target) return mobile ? "whatsapp://send" : "https://web.whatsapp.com/";
  if (target.kind === "phone")
    return mobile
      ? `whatsapp://send?phone=${target.phone}`
      : `https://web.whatsapp.com/send?phone=${target.phone}`;
  return mobile
    ? `https://chat.whatsapp.com/${target.code}`
    : `https://web.whatsapp.com/accept?code=${target.code}`;
}

export function normalizeAlarmImagePrefs(raw: unknown): AlarmImagePrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_ALARM_IMAGE_PREFS;
  const list: unknown[] = Array.isArray(r.columns) ? r.columns : d.columns;
  return {
    // fixed order; the site is what a row is about — never hidden
    columns: ALARM_IMAGE_COLUMNS.map((c) => c.id).filter(
      (id) => id === "site" || list.includes(id),
    ),
    byOffice: typeof r.byOffice === "boolean" ? r.byOffice : d.byOffice,
    rowsPerImage: ALARM_IMAGE_ROWS.includes(r.rowsPerImage as (typeof ALARM_IMAGE_ROWS)[number])
      ? (r.rowsPerImage as number)
      : d.rowsPerImage,
    sort: ALARM_IMAGE_SORTS.some((x) => x.id === r.sort) ? (r.sort as AlarmImageSort) : d.sort,
    officeColors: Object.fromEntries(
      Object.entries(r.officeColors && typeof r.officeColors === "object" ? r.officeColors : {})
        .filter(([k, v]) => k.trim() && typeof v === "string" && HEX.test(v))
        .slice(0, 50)
        .map(([k, v]) => [k.trim(), (v as string).toLowerCase()]),
    ),
    // the old single number becomes the "all images" chat
    shareAll: normalizeWhatsAppTarget(
      typeof r.shareAll === "string"
        ? r.shareAll
        : typeof r.whatsappPhone === "string"
          ? r.whatsappPhone
          : "",
    ),
    shareOffices: Object.fromEntries(
      Object.entries(r.shareOffices && typeof r.shareOffices === "object" ? r.shareOffices : {})
        .filter(([k, v]) => k.trim() && typeof v === "string")
        .map(([k, v]) => [k.trim(), normalizeWhatsAppTarget(v as string)] as const)
        .filter(([, v]) => v)
        .slice(0, 50),
    ),
    // before the switch existed, office chats alone meant "per office"
    shareMode:
      r.shareMode === "all" || r.shareMode === "office"
        ? r.shareMode
        : !r.shareAll && r.shareOffices && Object.keys(r.shareOffices).length
          ? "office"
          : "all",
  };
}

/** "451_S_BH-KOM-AZIZA_0D36DE" → "BH-KOM-AZIZA_0D36DE" (site name with its code). */
export function shortSite(site: string): string {
  const parts = site.split("_").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("_") : site;
}

export interface ImageAlarm {
  site: string;
  siteCode: string | null;
  category: string;
  alarmName: string;
  alarmTime: string;
  office: string | null;
  vip: boolean | null;
  nodality: string | null;
  battery?: string | null;
  powerSource: string | null;
  phone: string | null;
  labels?: readonly string[];
}

export interface SiteImageRow {
  key: string;
  site: string;
  office: string | null;
  /**
   * Oldest active alarm of the site (ISO) — of every category until withShownTime() narrows it
   * to the categories the image is about.
   */
  alarmTime: string;
  /** Active alarms per category. */
  counts: Record<Category, number>;
  /** Oldest active alarm per category (ISO), null when the site has none of it. */
  firstTime: Record<Category, string | null>;
  alarmNames: string[];
  tags: string[];
  /** "YES" (Site Master or the VIP mail label), "NO" (Site Master says not VIP), "" unknown. */
  vip: string;
  /** Site Master nodality ("1+0", "1+2"), "NODAL" when only the mail label says so, "" unknown. */
  nodal: string;
  phone: string | null;
}

/** Active alarms → one row per site (siteCode, else the site), oldest first. */
export function siteImageRows(alarms: readonly ImageAlarm[]): SiteImageRow[] {
  const bySite = new Map<string, SiteImageRow>();
  for (const a of alarms) {
    const key = a.siteCode ?? a.site;
    let row = bySite.get(key);
    if (!row) {
      row = {
        key,
        site: shortSite(a.site),
        office: a.office,
        alarmTime: a.alarmTime,
        counts: { DOWN: 0, POWER: 0, OTHER: 0 },
        firstTime: { DOWN: null, POWER: null, OTHER: null },
        alarmNames: [],
        tags: siteTags(a),
        vip: "",
        nodal: "",
        phone: a.phone,
      };
      bySite.set(key, row);
    }
    const cat = (a.category in row.counts ? a.category : "OTHER") as Category;
    row.counts[cat] += 1;
    if (a.alarmTime < row.alarmTime) row.alarmTime = a.alarmTime;
    const first = row.firstTime[cat];
    if (!first || a.alarmTime < first) row.firstTime[cat] = a.alarmTime;
    if (!row.alarmNames.includes(a.alarmName)) row.alarmNames.push(a.alarmName);
    row.office ??= a.office;
    row.phone ??= a.phone;
    if (!row.nodal && a.nodality?.trim()) row.nodal = a.nodality.trim();
    if (a.vip === false && !row.vip) row.vip = "NO";
  }
  for (const row of bySite.values()) {
    if (row.tags.includes("VIP")) row.vip = "YES";
    if (!row.nodal && row.tags.includes("NODAL")) row.nodal = "NODAL";
  }
  return [...bySite.values()].sort(
    (a, b) => a.alarmTime.localeCompare(b.alarmTime) || a.site.localeCompare(b.site),
  );
}

/** "DN/Kafr ElDawar" → "Kafr ElDawar"; rows without an office sort last. */
function officeName(office: string | null): string {
  return office ? (office.split("/").pop() ?? office) : "￿";
}

/** Rows → image groups: all offices together, or one group per office (by name). */
export function siteImageGroups(
  rows: readonly SiteImageRow[],
  byOffice: boolean,
): { label: string; rows: SiteImageRow[] }[] {
  if (!byOffice) return [{ label: "", rows: [...rows] }];
  const groups = new Map<string, SiteImageRow[]>();
  for (const r of rows) {
    const label = r.office ? (r.office.split("/").pop() ?? r.office) : "No office";
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rows]) => ({ label, rows }));
}

/** Text of a category cell: "✓", or "✓ 3" for several alarms; "" when the site has none. */
export function categoryMark(count: number): string {
  return count === 0 ? "" : count === 1 ? "✓" : `✓ ${count}`;
}

const MARK_CATEGORY: Partial<Record<AlarmImageColumn, Category>> = {
  down: "DOWN",
  power: "POWER",
  other: "OTHER",
};

/** The category a Down / Power / Other column marks (undefined for other columns). */
export function markCategory(column: AlarmImageColumn): Category | undefined {
  return MARK_CATEGORY[column];
}

/**
 * Only sites with an alarm in a shown category column: with Down + Power shown and Other
 * hidden, a site that has only OTHER alarms is left out. No category column → every site.
 */
export function visibleSiteRows(
  rows: readonly SiteImageRow[],
  columns: readonly AlarmImageColumn[],
): SiteImageRow[] {
  const cats = columns.map(markCategory).filter((c): c is Category => !!c);
  return cats.length ? rows.filter((r) => cats.some((c) => r.counts[c] > 0)) : [...rows];
}

/**
 * The categories the image is about: the page's category tab when one is picked, else the
 * shown Down / Power / Other columns, else all three.
 */
export function shownCategories(
  columns: readonly AlarmImageColumn[],
  tab?: Category | readonly Category[] | "" | null,
): Category[] {
  if (Array.isArray(tab)) {
    if (tab.length) return [...tab];
  } else if (tab) return [tab as Category];
  const cats = columns.map(markCategory).filter((c): c is Category => !!c);
  return cats.length ? cats : ["DOWN", "POWER", "OTHER"];
}

/** One table of the image set: its heading word and the categories it is about. */
export interface CategoryTable {
  label: string;
  cats: readonly Category[];
}

const DOWN_T: CategoryTable = { label: "Down", cats: ["DOWN"] };
const POWER_T: CategoryTable = { label: "Power", cats: ["POWER"] };
const OTHER_T: CategoryTable = { label: "Other", cats: ["OTHER"] };
const ENV_T: CategoryTable = { label: "Power + Other", cats: ["POWER", "OTHER"] };

/**
 * Category choice of the Export image window (user request 2026-10-28). `tables` = the tables
 * it draws: all categories in one table, one table per category, Down vs Power + Other, or one
 * category (set). A site with alarms of two tables' categories is in both.
 */
export const ALARM_IMAGE_CATEGORIES = [
  { id: "all", label: "All categories · one table", tables: [{ label: "", cats: [] }] },
  { id: "all_each", label: "All · one table per category", tables: [DOWN_T, POWER_T, OTHER_T] },
  { id: "all_down_env", label: "All · Down | Power + Other", tables: [DOWN_T, ENV_T] },
  { id: "DOWN", label: "Down", tables: [DOWN_T] },
  { id: "POWER", label: "Power", tables: [POWER_T] },
  { id: "OTHER", label: "Other", tables: [OTHER_T] },
  { id: "POWER_OTHER", label: "Power + Other", tables: [ENV_T] },
] as const satisfies readonly { id: string; label: string; tables: readonly CategoryTable[] }[];
export type AlarmImageCategory = (typeof ALARM_IMAGE_CATEGORIES)[number]["id"];

/** Every category the choice covers ([] = all). */
export function choiceCategories(id: AlarmImageCategory): Category[] {
  const tables = ALARM_IMAGE_CATEGORIES.find((c) => c.id === id)!.tables;
  const cats = new Set<Category>(tables.flatMap((t) => t.cats));
  return cats.size === 3 ? [] : [...cats];
}

/** The page's category tab ("" = All) → the window's starting choice. */
export function imageCategoryOf(tab: string): AlarmImageCategory {
  return ALARM_IMAGE_CATEGORIES.some((c) => c.id === tab) ? (tab as AlarmImageCategory) : "all";
}

/** Only sites with an alarm of the chosen categories (none chosen = every site). */
export function sitesWithCategories(
  rows: readonly SiteImageRow[],
  cats: readonly Category[],
): SiteImageRow[] {
  return cats.length ? rows.filter((r) => cats.some((c) => r.counts[c] > 0)) : [...rows];
}

/**
 * Time (and so age and the oldest / newest sort) of a row = its oldest alarm OF THOSE
 * categories (bug 2026-10-28: a site in the Power tab showed the time of an older, hidden
 * Other alarm). Rows without any of them keep their time (they are filtered out anyway).
 */
export function withShownTime(
  rows: readonly SiteImageRow[],
  cats: readonly Category[],
): SiteImageRow[] {
  return rows.map((r) => {
    const times = cats.map((c) => r.firstTime[c]).filter((t): t is string => !!t);
    return times.length ? { ...r, alarmTime: times.reduce((a, b) => (b < a ? b : a)) } : r;
  });
}

/** Alarms of those categories in the rows (the image footer's "n alarms"). */
export function shownAlarmCount(rows: readonly SiteImageRow[], cats: readonly Category[]): number {
  return rows.reduce((s, r) => s + cats.reduce((n, c) => n + r.counts[c], 0), 0);
}

/**
 * Rows in the chosen order; ties fall back to the oldest alarm first, then the site.
 * `officeFirst` (all offices in one table, user 2026-10-28): grouped by office name first (no
 * office last), the chosen order within each office.
 */
export function sortSiteRows(
  rows: readonly SiteImageRow[],
  sort: AlarmImageSort,
  officeFirst = false,
): SiteImageRow[] {
  const oldest = (a: SiteImageRow, b: SiteImageRow) =>
    a.alarmTime.localeCompare(b.alarmTime) || a.site.localeCompare(b.site);
  const by: Record<AlarmImageSort, (a: SiteImageRow, b: SiteImageRow) => number> = {
    oldest,
    newest: (a, b) => b.alarmTime.localeCompare(a.alarmTime) || a.site.localeCompare(b.site),
    down: (a, b) =>
      b.counts.DOWN - a.counts.DOWN || b.counts.POWER - a.counts.POWER || oldest(a, b),
    power: (a, b) =>
      b.counts.POWER - a.counts.POWER || b.counts.DOWN - a.counts.DOWN || oldest(a, b),
    site: (a, b) => a.site.localeCompare(b.site),
  };
  const office = (a: SiteImageRow, b: SiteImageRow) =>
    officeFirst ? officeName(a.office).localeCompare(officeName(b.office)) : 0;
  return [...rows].sort((a, b) => office(a, b) || by[sort](a, b));
}

// Hourly report output settings (users.uiPrefs.hourly): which rows and columns the table, the
// WhatsApp images, the Excel export and the PDF show, how rows are sorted, coloured by alarm
// age and split into groups (category / office). Browser-safe — the web pages and the API's
// Excel export share it, so every output looks the same.

import type { Category } from "../index.js";
import { HOURLY_SORT_BY_SITE, HOURLY_DEFAULT_SORT, type HourlySort } from "./filter.js";
import {
  HOURLY_COLUMN_KEYS,
  HOURLY_COMPACT_COLUMNS,
  HOURLY_DEFAULT_COLUMNS,
  HOURLY_SHEETS,
  officeColor,
  type HourlyColumnKey,
  type HourlyRow,
  type HourlySheet,
} from "./types.js";

const CATS: readonly Category[] = ["DOWN", "POWER", "OTHER"];

/**
 * How images / Excel sheets / PDF sections are split by category:
 * none · DOWN vs (POWER + OTHER) · DOWN, POWER and OTHER each on their own.
 */
export const HOURLY_SPLIT_MODES = ["none", "downVsRest", "category"] as const;
export type HourlySplitMode = (typeof HOURLY_SPLIT_MODES)[number];

/** Age colouring paints the whole row, or only the chosen columns. */
export const HOURLY_AGE_TARGETS = ["row", "columns"] as const;
export type HourlyAgeTarget = (typeof HOURLY_AGE_TARGETS)[number];

/** Rows older than `hours` (report time − alarm time) get `color` ("RRGGBB", no '#'). */
export interface HourlyAgeRule {
  hours: number;
  color: string;
}

export const HOURLY_ROWS_PER_IMAGE = [25, 40, 60, 100] as const;

export interface HourlyPrefs {
  /** Rows only in hidden sheets are left out (a row in several sheets stays if one is shown). */
  hiddenSheets: HourlySheet[];
  hiddenCategories: Category[];
  /** Exact alarmName values, upper-case. */
  hiddenAlarms: string[];
  /** Visible columns in order: table, Excel and PDF. */
  tableColumns: HourlyColumnKey[];
  /** Visible columns in order: WhatsApp images. */
  imageColumns: HourlyColumnKey[];
  /** Default sort office → site code → newest alarm, so a site's alarms sit together. */
  sortBySite: boolean;
  ageColors: {
    enabled: boolean;
    /** Ascending by hours; the highest rule the age reaches wins. */
    rules: HourlyAgeRule[];
    target: HourlyAgeTarget;
    /** Columns painted when target = "columns". */
    columns: HourlyColumnKey[];
  };
  /** Groups of the images, Excel sheets and PDF sections. */
  split: { mode: HourlySplitMode; byOffice: boolean };
  imageRowsPerPage: number;
}

export const DEFAULT_HOURLY_PREFS: HourlyPrefs = {
  hiddenSheets: [],
  hiddenCategories: [],
  hiddenAlarms: [],
  tableColumns: HOURLY_DEFAULT_COLUMNS,
  imageColumns: HOURLY_COMPACT_COLUMNS,
  sortBySite: false,
  ageColors: {
    enabled: true,
    rules: [{ hours: 3, color: "FCA5A5" }],
    target: "row",
    columns: ["alarmTime"],
  },
  split: { mode: "category", byOffice: false },
  imageRowsPerPage: 40,
};

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Known keys only, no duplicates, order kept; empty → `fallback`. */
function columnList(v: unknown, fallback: HourlyColumnKey[]): HourlyColumnKey[] {
  const keys = [
    ...new Set(strings(v).filter((k): k is HourlyColumnKey => (HOURLY_COLUMN_KEYS as string[]).includes(k))),
  ];
  return keys.length ? keys : fallback;
}

/** "#fca5a5" / "FCA5A5" → "FCA5A5"; anything else → null. */
export function hexColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : null;
}

/** Any stored / submitted value → complete, valid HourlyPrefs. */
export function normalizeHourlyPrefs(raw: unknown): HourlyPrefs {
  const r = obj(raw);
  const d = DEFAULT_HOURLY_PREFS;
  const age = obj(r.ageColors);
  const split = obj(r.split);
  const rawRules = Array.isArray(age.rules) ? age.rules : null;
  const rules = new Map<number, string>();
  for (const x of rawRules ?? []) {
    const hours = Number(obj(x).hours);
    const color = hexColor(obj(x).color);
    if (Number.isFinite(hours) && hours > 0 && hours <= 720 && color) rules.set(Math.round(hours * 4) / 4, color);
  }
  const perPage = Number(r.imageRowsPerPage);
  return {
    hiddenSheets: [...new Set(strings(r.hiddenSheets))].filter((s): s is HourlySheet =>
      (HOURLY_SHEETS as readonly string[]).includes(s),
    ),
    hiddenCategories: [...new Set(strings(r.hiddenCategories))].filter((c): c is Category =>
      (CATS as string[]).includes(c),
    ),
    hiddenAlarms: [...new Set(strings(r.hiddenAlarms).map((s) => s.trim().toUpperCase()).filter(Boolean))]
      .slice(0, 1000),
    tableColumns: columnList(r.tableColumns, d.tableColumns),
    imageColumns: columnList(r.imageColumns, d.imageColumns),
    sortBySite: typeof r.sortBySite === "boolean" ? r.sortBySite : d.sortBySite,
    ageColors: {
      enabled: typeof age.enabled === "boolean" ? age.enabled : d.ageColors.enabled,
      // an explicitly empty list stays empty (the user removed every rule)
      rules: rawRules
        ? [...rules].sort((a, b) => a[0] - b[0]).slice(0, 10).map(([hours, color]) => ({ hours, color }))
        : d.ageColors.rules,
      target: HOURLY_AGE_TARGETS.includes(age.target as HourlyAgeTarget)
        ? (age.target as HourlyAgeTarget)
        : d.ageColors.target,
      columns: columnList(age.columns, d.ageColors.columns),
    },
    split: {
      mode: HOURLY_SPLIT_MODES.includes(split.mode as HourlySplitMode)
        ? (split.mode as HourlySplitMode)
        : d.split.mode,
      byOffice: typeof split.byOffice === "boolean" ? split.byOffice : d.split.byOffice,
    },
    imageRowsPerPage: (HOURLY_ROWS_PER_IMAGE as readonly number[]).includes(perPage)
      ? perPage
      : d.imageRowsPerPage,
  };
}

/** Number of hidden sheets + categories + alarm names. */
export const hourlyHiddenCount = (p: HourlyPrefs): number =>
  p.hiddenSheets.length + p.hiddenCategories.length + p.hiddenAlarms.length;

/** Rows left after the user's hidden sheets / categories / alarm names. */
export function visibleHourlyRows(rows: readonly HourlyRow[], p: HourlyPrefs): HourlyRow[] {
  if (!hourlyHiddenCount(p)) return [...rows];
  const sheets = new Set<string>(p.hiddenSheets);
  const cats = new Set<string>(p.hiddenCategories);
  const alarms = new Set(p.hiddenAlarms);
  return rows.filter(
    (r) =>
      !cats.has(r.category) &&
      !alarms.has(r.alarmName.toUpperCase()) &&
      (!sheets.size || r.sheets.some((s) => !sheets.has(s))),
  );
}

/** Sort used when the user has not clicked a column header. */
export const hourlySortFor = (p: HourlyPrefs): HourlySort =>
  p.sortBySite ? HOURLY_SORT_BY_SITE : HOURLY_DEFAULT_SORT;

/**
 * Copies of the rows with `siteNo` (1, 2, … by first appearance of the site code — rows of one
 * site share the number, the last one is the number of sites) and `siteAlarms` (rows of that
 * code in the list). Rows without a code get neither.
 */
export function numberSites(rows: readonly HourlyRow[]): HourlyRow[] {
  const no = new Map<string, number>();
  const count = new Map<string, number>();
  for (const r of rows) {
    if (!r.code) continue;
    if (!no.has(r.code)) no.set(r.code, no.size + 1);
    count.set(r.code, (count.get(r.code) ?? 0) + 1);
  }
  return rows.map((r) =>
    r.code ? { ...r, siteNo: no.get(r.code), siteAlarms: count.get(r.code) } : { ...r, siteNo: undefined, siteAlarms: undefined },
  );
}

/** Distinct site codes in the rows. */
export const hourlySiteCount = (rows: readonly HourlyRow[]): number =>
  new Set(rows.map((r) => r.code).filter(Boolean)).size;

const wallMs = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)) : NaN;
};

/** Hours between the alarm time and `ref` (both wall clock "YYYY-MM-DD HH:mm:ss"); null when unknown. */
export function hourlyAgeHours(row: Pick<HourlyRow, "alarmTime" | "clockInvalid">, ref: string): number | null {
  if (row.clockInvalid) return null;
  const h = (wallMs(ref) - wallMs(row.alarmTime)) / 3_600_000;
  return Number.isFinite(h) ? h : null;
}

/** Age colour of a row ("RRGGBB") or null when no rule applies / colouring is off. */
export function hourlyAgeColor(
  row: Pick<HourlyRow, "alarmTime" | "clockInvalid">,
  ref: string | null,
  age: HourlyPrefs["ageColors"],
): string | null {
  if (!age.enabled || !ref || !age.rules.length) return null;
  const h = hourlyAgeHours(row, ref);
  if (h === null) return null;
  let color: string | null = null;
  for (const rule of age.rules) if (h >= rule.hours) color = rule.color;
  return color;
}

/**
 * Background of one cell in every output: the age colour where it applies (whole row or the
 * chosen columns), otherwise the office colour; null = no fill.
 */
export function hourlyCellFill(
  row: HourlyRow,
  key: HourlyColumnKey,
  ref: string | null,
  p: HourlyPrefs,
): string | null {
  const age = hourlyAgeColor(row, ref, p.ageColors);
  if (age && (p.ageColors.target === "row" || p.ageColors.columns.includes(key))) return age;
  return officeColor(row.office);
}

export interface HourlyGroup {
  /** "DOWN", "POWER + OTHER", "TANTA · DOWN", … — "" when not split. */
  label: string;
  office: string | null;
  categories: Category[] | null;
  /** In input order, numbered per group (numberSites). */
  rows: HourlyRow[];
}

/**
 * Rows → output groups (images / Excel sheets / PDF sections). Offices A→Z with unknown codes
 * last, then categories in DOWN, POWER, OTHER order; empty groups are dropped. Always at least
 * one group (possibly with no rows).
 */
export function splitHourlyRows(rows: readonly HourlyRow[], split: HourlyPrefs["split"]): HourlyGroup[] {
  const catGroups: Category[][] | null =
    split.mode === "category"
      ? CATS.map((c) => [c])
      : split.mode === "downVsRest"
        ? [["DOWN"], ["POWER", "OTHER"]]
        : null;
  const offices: (string | null)[] = split.byOffice
    ? [...new Set(rows.map((r) => r.office))].sort((a, b) => (!a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0))
    : [null];
  const out: HourlyGroup[] = [];
  for (const office of offices) {
    const inOffice = office === null ? rows : rows.filter((r) => r.office === office);
    for (const cats of catGroups ?? [null]) {
      const g = cats ? inOffice.filter((r) => cats.includes(r.category)) : inOffice;
      if (!g.length) continue;
      const officeLabel = office === null ? "" : office || "Unknown office";
      const label = [officeLabel, cats ? cats.join(" + ") : ""].filter(Boolean).join(" · ");
      out.push({ label, office, categories: cats, rows: numberSites(g) });
    }
  }
  return out.length ? out : [{ label: "", office: null, categories: null, rows: [] }];
}

// Hourly report output settings (users.uiPrefs.hourly): which rows and columns the table and the
// images show, how rows are sorted, how cells are coloured (by alarm age or office) and which
// image sets "Export image" makes. Browser-safe — the web pages and the API's Excel export share
// it, so every output looks the same.

import type { Category } from "../index.js";
import { isNodal } from "../siteFlags.js";
import { HOURLY_SORT_BY_SITE, HOURLY_DEFAULT_SORT, type HourlySort } from "./filter.js";
import {
  HOURLY_COLUMN_KEYS,
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

/**
 * Colour rule: rows whose alarm is older than `hours` (report mail time − Alarm Time) get
 * `color` ("RRGGBB", no '#') in the chosen `columns` — empty = the whole row; the highest
 * period reached wins. Office colours are a separate list (`colors.offices`): the "office"
 * rule kind was removed 2026-10-29 (user request), old office rules move into that list.
 */
export type HourlyColorRule = {
  kind: "age";
  hours: number;
  color: string;
  columns: HourlyColumnKey[];
};

/** Default sort: newest alarm first, or by site code (a site's alarms sit together). */
export const HOURLY_SORT_CHOICES = ["time", "code"] as const;
export type HourlySortChoice = (typeof HOURLY_SORT_CHOICES)[number];

/**
 * Image sets made by "Export image" (each on / off in the settings):
 * down — DOWN alarms (all offices in one set, or one per office);
 * downSites — DOWN, all offices, one row per site code: how many sites are down;
 * env — Environmental = POWER + OTHER (all offices together, or one per office);
 * envVipNodal — Environmental, VIP or Nodal sites only;
 * power — POWER alarms only.
 */
export const HOURLY_IMAGE_SETS = ["down", "downSites", "env", "envVipNodal", "power"] as const;
export type HourlyImageSet = (typeof HOURLY_IMAGE_SETS)[number];
/** Sets that can be split per office. */
export const HOURLY_IMAGE_SETS_BY_OFFICE: readonly HourlyImageSet[] = [
  "down",
  "env",
  "envVipNodal",
];

export const HOURLY_ROWS_PER_IMAGE = [25, 40, 60, 100] as const;

/**
 * One image set. Offices: all in one image, one image per office (`byOffice`), or office
 * groups (`grouped`, user request 2026-10-29): offices packed together automatically, as many
 * whole offices as fit in "Rows per image" (an office with more rows than that stands alone).
 */
export interface HourlyImageSetPrefs {
  enabled: boolean;
  byOffice: boolean;
  grouped: boolean;
}

export type HourlyOfficeMode = "all" | "each" | "groups";

export function hourlyOfficeMode(p: HourlyImageSetPrefs): HourlyOfficeMode {
  return p.grouped ? "groups" : p.byOffice ? "each" : "all";
}

const setPrefs = (enabled: boolean): HourlyImageSetPrefs => ({
  enabled,
  byOffice: false,
  grouped: false,
});

/**
 * Items with a size → bins of at most `capacity`: biggest first, each into the first bin it
 * still fits in (first-fit decreasing), else a new bin; an item of `capacity` or more gets a
 * bin of its own. Bins in the order they were opened, items inside biggest first.
 */
export function packOffices<T>(
  items: readonly T[],
  size: (t: T) => number,
  capacity: number,
): T[][] {
  const bins: { used: number; items: T[] }[] = [];
  for (const it of [...items].sort((a, b) => size(b) - size(a))) {
    const n = size(it);
    const bin = n < capacity ? bins.find((b) => b.used + n <= capacity) : undefined;
    if (bin) {
      bin.used += n;
      bin.items.push(it);
    } else bins.push({ used: n, items: [it] });
  }
  return bins.map((b) => b.items);
}

export interface HourlyPrefs {
  /** Rows only in hidden sheets are left out (a row in several sheets stays if one is shown). */
  hiddenSheets: HourlySheet[];
  hiddenCategories: Category[];
  /** Exact alarmName values, upper-case. */
  hiddenAlarms: string[];
  /**
   * Category given to an alarm name instead of the one its sheet gives (upper-case name →
   * DOWN | POWER | OTHER), user request 2026-10-29. Moves its rows between the image sets too.
   */
  alarmCategories?: Record<string, Category>;
  /**
   * Per alarm name, site codes or full site names where it does the opposite: a hidden alarm
   * still shows there, a shown one is hidden (like Display alarms' site exceptions).
   */
  alarmSites?: Record<string, string[]>;
  /** Visible columns in order: the table, the images and the Excel export. */
  tableColumns: HourlyColumnKey[];
  sort: HourlySortChoice;
  colors: {
    enabled: boolean;
    rules: HourlyColorRule[];
    /**
     * Colour of the Office cell per office (Site Master name, upper-case → "RRGGBB"); offices
     * not listed keep the built-in office colour on the whole row (user request 2026-10-29).
     */
    offices?: Record<string, string>;
    /** A listed office's other cells get a lighter shade of its colour (else no colour). */
    officeRowTint?: boolean;
  };
  images: Record<HourlyImageSet, HourlyImageSetPrefs>;
  /** Groups of the Excel sheets (API export; not shown in the settings). */
  split: { mode: HourlySplitMode; byOffice: boolean };
  imageRowsPerPage: number;
}

export const DEFAULT_HOURLY_PREFS: HourlyPrefs = {
  hiddenSheets: [],
  hiddenCategories: [],
  hiddenAlarms: [],
  tableColumns: HOURLY_DEFAULT_COLUMNS,
  sort: "time",
  colors: {
    enabled: true,
    rules: [{ kind: "age", hours: 3, color: "FCA5A5", columns: [] }],
    offices: {},
    officeRowTint: true,
  },
  images: {
    down: setPrefs(true),
    downSites: setPrefs(true),
    env: setPrefs(true),
    envVipNodal: setPrefs(false),
    power: setPrefs(false),
  },
  split: { mode: "category", byOffice: false },
  imageRowsPerPage: 40,
  alarmCategories: {},
  alarmSites: {},
};

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Known keys only, no duplicates, order kept; empty → `fallback`. */
function columnList(v: unknown, fallback: HourlyColumnKey[]): HourlyColumnKey[] {
  const keys = [
    ...new Set(
      strings(v).filter((k): k is HourlyColumnKey => (HOURLY_COLUMN_KEYS as string[]).includes(k)),
    ),
  ];
  return keys.length ? keys : fallback;
}

/** "#fca5a5" / "FCA5A5" → "FCA5A5"; anything else → null. */
export function hexColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : null;
}

/** Known keys only, no duplicates, order kept; may be empty. */
const columnSubset = (v: unknown): HourlyColumnKey[] => [
  ...new Set(
    strings(v).filter((k): k is HourlyColumnKey => (HOURLY_COLUMN_KEYS as string[]).includes(k)),
  ),
];

/** One stored rule → a valid rule, or null. */
function colorRule(v: unknown): HourlyColorRule | null {
  const x = obj(v);
  const color = hexColor(x.color);
  if (!color) return null;
  const columns = columnSubset(x.columns);
  // office rules are read into the office colour list instead (colorRules)
  if (x.kind === "office") return null;
  const hours = Number(x.hours);
  return Number.isFinite(hours) && hours > 0 && hours <= 720
    ? { kind: "age", hours: Math.round(hours * 4) / 4, color, columns }
    : null;
}

/** "RRGGBB" mixed with white: `amount` 0 = the colour, 1 = white. */
export function lighterColor(hex: string, amount = 0.65): string {
  const n = parseInt(hex, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => mix(c).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Office → colour list as stored: upper-case names, valid colours, at most 100. */
function officeColorList(v: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj(v))
      .map(([k, c]) => [k.trim().toUpperCase(), hexColor(c)] as const)
      .filter((e): e is readonly [string, string] => !!e[0] && !!e[1])
      .slice(0, 100),
  );
}

/** Colour rules, also from the older `ageColors` shape (2026-10-22: periods + row / columns). */
function colorRules(r: Record<string, unknown>): HourlyPrefs["colors"] {
  const c0 = obj(r.colors);
  // a former office rule becomes that office's colour, unless the list already has one
  const fromRules = Object.fromEntries(
    (Array.isArray(c0.rules) ? c0.rules : [])
      .map(obj)
      .filter((x) => x.kind === "office" && typeof x.office === "string")
      .map((x) => [(x.office as string).trim().toUpperCase(), hexColor(x.color)] as const)
      .filter((e): e is readonly [string, string] => !!e[0] && !!e[1]),
  );
  return {
    ...colorRuleList(r),
    offices: { ...fromRules, ...officeColorList(c0.offices) },
    officeRowTint: typeof c0.officeRowTint === "boolean" ? c0.officeRowTint : true,
  };
}

function colorRuleList(
  r: Record<string, unknown>,
): Pick<HourlyPrefs["colors"], "enabled" | "rules"> {
  const d = DEFAULT_HOURLY_PREFS.colors;
  const c = obj(r.colors);
  if (Array.isArray(c.rules))
    return {
      enabled: typeof c.enabled === "boolean" ? c.enabled : d.enabled,
      rules: c.rules
        .map(colorRule)
        .filter((x): x is HourlyColorRule => !!x)
        .slice(0, 30),
    };
  const age = obj(r.ageColors);
  if (!Array.isArray(age.rules)) return d;
  const columns = age.target === "columns" ? columnSubset(age.columns) : [];
  return {
    enabled: typeof age.enabled === "boolean" ? age.enabled : d.enabled,
    rules: age.rules
      .map((x) => colorRule({ ...obj(x), kind: "age", columns }))
      .filter((x): x is HourlyColorRule => !!x)
      .slice(0, 30),
  };
}

/** Any stored / submitted value → complete, valid HourlyPrefs. */
export function normalizeHourlyPrefs(raw: unknown): HourlyPrefs {
  const r = obj(raw);
  const d = DEFAULT_HOURLY_PREFS;
  const split = obj(r.split);
  const images = obj(r.images);
  const perPage = Number(r.imageRowsPerPage);
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    hiddenSheets: [...new Set(strings(r.hiddenSheets))].filter((s): s is HourlySheet =>
      (HOURLY_SHEETS as readonly string[]).includes(s),
    ),
    hiddenCategories: [...new Set(strings(r.hiddenCategories))].filter((c): c is Category =>
      (CATS as string[]).includes(c),
    ),
    hiddenAlarms: [
      ...new Set(
        strings(r.hiddenAlarms)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ].slice(0, 1000),
    tableColumns: columnList(r.tableColumns, d.tableColumns),
    // older settings: sortBySite true → by site code
    sort: HOURLY_SORT_CHOICES.includes(r.sort as HourlySortChoice)
      ? (r.sort as HourlySortChoice)
      : r.sortBySite === true
        ? "code"
        : d.sort,
    // an explicitly empty rule list stays empty (the user removed every rule)
    colors: colorRules(r),
    images: Object.fromEntries(
      HOURLY_IMAGE_SETS.map((k) => {
        const x = obj(images[k]);
        const split = HOURLY_IMAGE_SETS_BY_OFFICE.includes(k);
        const grouped = split && bool(x.grouped, false);
        return [
          k,
          {
            enabled: bool(x.enabled, d.images[k].enabled),
            byOffice: split && !grouped && bool(x.byOffice, d.images[k].byOffice),
            grouped,
          },
        ];
      }),
    ) as HourlyPrefs["images"],
    split: {
      mode: HOURLY_SPLIT_MODES.includes(split.mode as HourlySplitMode)
        ? (split.mode as HourlySplitMode)
        : d.split.mode,
      byOffice: typeof split.byOffice === "boolean" ? split.byOffice : d.split.byOffice,
    },
    imageRowsPerPage: (HOURLY_ROWS_PER_IMAGE as readonly number[]).includes(perPage)
      ? perPage
      : d.imageRowsPerPage,
    alarmCategories: Object.fromEntries(
      Object.entries(obj(r.alarmCategories))
        .map(([k, v]) => [k.trim().toUpperCase(), v] as const)
        .filter(
          (e): e is readonly [string, Category] => !!e[0] && (CATS as unknown[]).includes(e[1]),
        )
        .slice(0, 1000),
    ),
    alarmSites: Object.fromEntries(
      Object.entries(obj(r.alarmSites))
        .map(
          ([k, v]) =>
            [
              k.trim().toUpperCase(),
              [
                ...new Set(
                  strings(v)
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean),
                ),
              ].slice(0, 200),
            ] as const,
        )
        .filter(([k, v]) => k && v.length)
        .slice(0, 1000),
    ),
  };
}

/** Number of hidden sheets + categories + alarm names. */
export const hourlyHiddenCount = (p: HourlyPrefs): number =>
  p.hiddenSheets.length + p.hiddenCategories.length + p.hiddenAlarms.length;

/** The category of a row after the user's per-alarm change (if any). */
export function hourlyRowCategory(r: HourlyRow, p: HourlyPrefs): Category {
  return p.alarmCategories?.[r.alarmName.trim().toUpperCase()] ?? r.category;
}

/**
 * Rows left after the user's hidden sheets / categories / alarm names. A hidden name also hides
 * the rows whose Alarm Text is that name (2026-10-25): hiding "BASE STATION EXTERNAL ALARM
 * NOTIFICATION" removes every Environmental row that carries it, whatever its own alarm name.
 */
export function visibleHourlyRows(rows: readonly HourlyRow[], p: HourlyPrefs): HourlyRow[] {
  const recat = Object.keys(p.alarmCategories ?? {}).length > 0;
  const siteRules = p.alarmSites ?? {};
  if (!hourlyHiddenCount(p) && !recat && !Object.keys(siteRules).length) return [...rows];
  const sheets = new Set<string>(p.hiddenSheets);
  const cats = new Set<string>(p.hiddenCategories);
  const alarms = new Set(p.hiddenAlarms);
  const out: HourlyRow[] = [];
  for (const r0 of rows) {
    const r = recat ? { ...r0, category: hourlyRowCategory(r0, p) } : r0;
    const name = r.alarmName.trim().toUpperCase();
    const text = r.alarmText.trim().toUpperCase();
    const typeHidden = cats.has(r.category) || alarms.has(name) || alarms.has(text);
    // at its exception sites a name does the opposite (hidden → shown, shown → hidden)
    const sites = siteRules[name] ?? siteRules[text];
    const excepted =
      !!sites &&
      (sites.includes(r.code.trim().toUpperCase()) ||
        sites.includes(r.siteName.trim().toUpperCase()));
    if (typeHidden !== excepted) continue;
    if (sheets.size && !r.sheets.some((s) => !sheets.has(s))) continue;
    out.push(r);
  }
  return out;
}

/** Sort used when the user has not clicked a column header. */
export const hourlySortFor = (p: HourlyPrefs): HourlySort =>
  p.sort === "code" ? HOURLY_SORT_BY_SITE : HOURLY_DEFAULT_SORT;

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
    r.code
      ? { ...r, siteNo: no.get(r.code), siteAlarms: count.get(r.code) }
      : { ...r, siteNo: undefined, siteAlarms: undefined },
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
export function hourlyAgeHours(
  row: Pick<HourlyRow, "alarmTime" | "clockInvalid">,
  ref: string,
): number | null {
  if (row.clockInvalid) return null;
  const h = (wallMs(ref) - wallMs(row.alarmTime)) / 3_600_000;
  return Number.isFinite(h) ? h : null;
}

const covers = (rule: HourlyColorRule, key: HourlyColumnKey) =>
  !rule.columns.length || rule.columns.includes(key);

/**
 * Background of one cell in every output: a matching office rule, else the highest age rule the
 * alarm reached (rules limited to other columns are skipped), else the built-in office colour;
 * null = no fill. Rows with an invalid NE clock never get an age colour.
 */
export function hourlyCellFill(
  row: HourlyRow,
  key: HourlyColumnKey,
  ref: string | null,
  p: HourlyPrefs,
): string | null {
  if (p.colors.enabled) {
    const h = ref ? hourlyAgeHours(row, ref) : null;
    if (h !== null) {
      let best: { hours: number; color: string } | null = null;
      for (const rule of p.colors.rules)
        if (
          rule.kind === "age" &&
          h >= rule.hours &&
          covers(rule, key) &&
          (!best || rule.hours >= best.hours)
        )
          best = rule;
      if (best) return best.color;
    }
  }
  // the office's chosen colour: on its Office cell, a lighter shade (or none) elsewhere
  const own = p.colors.offices?.[row.office.trim().toUpperCase()];
  if (own)
    return key === "office" ? own : p.colors.officeRowTint === false ? null : lighterColor(own);
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
export function splitHourlyRows(
  rows: readonly HourlyRow[],
  split: HourlyPrefs["split"],
): HourlyGroup[] {
  const catGroups: Category[][] | null =
    split.mode === "category"
      ? CATS.map((c) => [c])
      : split.mode === "downVsRest"
        ? [["DOWN"], ["POWER", "OTHER"]]
        : null;
  const offices: (string | null)[] = split.byOffice
    ? [...new Set(rows.map((r) => r.office))].sort((a, b) =>
        !a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0,
      )
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

/** Offices A→Z, unknown last. */
const officeOrder = (a: string | null, b: string | null) =>
  !a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0;

/**
 * A set's rows split by its office mode: one part (all), one per office (A→Z, unknown last), or
 * offices packed into parts of up to `rowsPerImage` rows (groups): inside a part the offices
 * follow one another, biggest first, each keeping the chosen row order.
 */
function officeParts(
  list: readonly HourlyRow[],
  p: HourlyImageSetPrefs,
  rowsPerImage: number,
): { name: string; office: string | null; rows: HourlyRow[] }[] {
  const mode = hourlyOfficeMode(p);
  if (mode === "all") return [{ name: "", office: null, rows: [...list] }];
  const perOffice = [...new Set(list.map((r) => r.office))].sort(officeOrder).map((office) => ({
    name: office || "Unknown office",
    office,
    rows: list.filter((r) => r.office === office),
  }));
  if (mode === "each") return perOffice;
  return packOffices(perOffice, (o) => o.rows.length, rowsPerImage).map((bin) => ({
    name: bin.map((o) => o.name).join(" + "),
    office: bin.length === 1 ? bin[0]!.office : null,
    rows: bin.flatMap((o) => o.rows),
  }));
}

export const HOURLY_IMAGE_SET_LABEL: Record<HourlyImageSet, string> = {
  down: "DOWN",
  downSites: "DOWN SITES",
  env: "ENVIRONMENTAL",
  envVipNodal: "ENVIRONMENTAL · VIP / NODAL",
  power: "POWER",
};

/**
 * Rows (already filtered and sorted) → the image groups of the enabled sets, in the order of
 * HOURLY_IMAGE_SETS; a set split per office gives one group per office (A→Z, unknown last).
 * "DOWN SITES" keeps the first alarm of each site code (rows without a code are left out), and
 * its `siteAlarms` still counts every DOWN alarm of that site. Empty groups are dropped; always
 * at least one group (possibly with no rows).
 */
export function hourlyImageGroups(
  rows: readonly HourlyRow[],
  images: HourlyPrefs["images"],
  rowsPerImage: number = DEFAULT_HOURLY_PREFS.imageRowsPerPage,
): HourlyGroup[] {
  const down = rows.filter((r) => r.category === "DOWN");
  const env = rows.filter((r) => r.category !== "DOWN");
  const source: Record<HourlyImageSet, { rows: readonly HourlyRow[]; categories: Category[] }> = {
    down: { rows: down, categories: ["DOWN"] },
    downSites: { rows: down, categories: ["DOWN"] },
    env: { rows: env, categories: ["POWER", "OTHER"] },
    envVipNodal: {
      rows: env.filter((r) => r.vip || isNodal(r.nodality)),
      categories: ["POWER", "OTHER"],
    },
    power: { rows: rows.filter((r) => r.category === "POWER"), categories: ["POWER"] },
  };
  const out: HourlyGroup[] = [];
  for (const set of HOURLY_IMAGE_SETS) {
    if (!images[set].enabled) continue;
    const { rows: list, categories } = source[set];
    const label = HOURLY_IMAGE_SET_LABEL[set];
    if (set === "downSites") {
      const seen = new Set<string>();
      const sites = numberSites(list).filter(
        (r) => r.code && !seen.has(r.code) && seen.add(r.code),
      );
      if (sites.length) out.push({ label, office: null, categories, rows: sites });
      continue;
    }
    for (const part of officeParts(list, images[set], rowsPerImage)) {
      if (!part.rows.length) continue;
      const name = part.name ? `${label} · ${part.name}` : label;
      out.push({ label: name, office: part.office, categories, rows: numberSites(part.rows) });
    }
  }
  return out.length ? out : [{ label: "", office: null, categories: null, rows: [] }];
}

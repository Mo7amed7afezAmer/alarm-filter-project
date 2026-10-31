// Alarm types hidden from display: admin setting (system_status.displayFilter, everyone) and
// personal setting (users.displayPrefs, one user). Pure part — the db package reads the rows.
// `siteExceptions` (2026-10-27, replaces the global `exceptSites` of 2026-10-25): per alarm name,
// sites (site code or full site name) where that alarm does the OPPOSITE — a hidden alarm still
// shows there, a shown alarm is hidden there.
import type { Category } from "./index.js";

export interface DisplayFilter {
  hiddenCategories: Category[];
  hiddenAlarmNames: string[];
  /** Alarm name → upper-case site codes ("0H31DE") or full site names where it is flipped. */
  siteExceptions: Record<string, string[]>;
}

export const EMPTY_DISPLAY_FILTER: DisplayFilter = {
  hiddenCategories: [],
  hiddenAlarmNames: [],
  siteExceptions: {},
};

const CATS = new Set(["DOWN", "POWER", "OTHER"]);
const MAX_NAMES = 1000;
const MAX_SITES = 200;

export function normalizeDisplayFilter(raw: unknown): DisplayFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()))]
      : [];
  const sites = (v: unknown) => [...new Set(list(v).map((s) => s.trim().toUpperCase()))];
  const hiddenAlarmNames = list(r.hiddenAlarmNames).slice(0, MAX_NAMES);

  const siteExceptions: Record<string, string[]> = {};
  const add = (name: string, more: string[]) => {
    const all = [...new Set([...(siteExceptions[name] ?? []), ...more])].slice(0, MAX_SITES);
    if (all.length) siteExceptions[name] = all;
  };
  const exc = r.siteExceptions;
  if (exc && typeof exc === "object" && !Array.isArray(exc))
    for (const [name, v] of Object.entries(exc).slice(0, MAX_NAMES))
      if (name.trim()) add(name, sites(v));
  // the old global list applied to every hidden name
  const legacy = sites(r.exceptSites);
  if (legacy.length) for (const name of hiddenAlarmNames) add(name, legacy);

  return {
    hiddenCategories: list(r.hiddenCategories).filter((c): c is Category => CATS.has(c)),
    hiddenAlarmNames,
    siteExceptions,
  };
}

export function hiddenCount(f: DisplayFilter): number {
  return f.hiddenCategories.length + f.hiddenAlarmNames.length;
}

/** Is the alarm's type hidden by this filter (before its site exceptions)? */
export function typeHidden(f: DisplayFilter, a: { category: string; alarmName: string }): boolean {
  return (
    (f.hiddenCategories as string[]).includes(a.category) ||
    f.hiddenAlarmNames.includes(a.alarmName)
  );
}

/** Does this filter hide the alarm? Its type is hidden XOR its site is an exception of its name. */
export function displayHides(
  f: DisplayFilter,
  a: { category: string; alarmName: string; site: string; siteCode?: string | null },
): boolean {
  const site = a.site.toUpperCase();
  const code = a.siteCode?.toUpperCase();
  const excepted = (f.siteExceptions[a.alarmName] ?? []).some((e) => e === site || e === code);
  return typeHidden(f, a) !== excepted;
}

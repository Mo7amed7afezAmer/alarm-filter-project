// Alarm types hidden from display: admin setting (system_status.displayFilter, everyone) and
// personal setting (users.displayPrefs, one user). Pure part — the db package reads the rows.
// `exceptSites` (2026-10-25): sites (site code or full site name) where the hidden types still
// show — e.g. hide "BCCH MISSING" everywhere except at the hub sites.
import type { Category } from "./index.js";

export interface DisplayFilter {
  hiddenCategories: Category[];
  hiddenAlarmNames: string[];
  /** Upper-case site codes ("0H31DE") or full site names; hidden types still show there. */
  exceptSites: string[];
}

export const EMPTY_DISPLAY_FILTER: DisplayFilter = {
  hiddenCategories: [],
  hiddenAlarmNames: [],
  exceptSites: [],
};

const CATS = new Set(["DOWN", "POWER", "OTHER"]);

export function normalizeDisplayFilter(raw: unknown): DisplayFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()))]
      : [];
  return {
    hiddenCategories: list(r.hiddenCategories).filter((c): c is Category => CATS.has(c)),
    hiddenAlarmNames: list(r.hiddenAlarmNames).slice(0, 1000),
    exceptSites: [...new Set(list(r.exceptSites).map((s) => s.trim().toUpperCase()))].slice(0, 200),
  };
}

export function hiddenCount(f: DisplayFilter): number {
  return f.hiddenCategories.length + f.hiddenAlarmNames.length;
}

/** Does this filter hide the alarm? Its type is hidden and its site is not an exception. */
export function displayHides(
  f: DisplayFilter,
  a: { category: string; alarmName: string; site: string; siteCode?: string | null },
): boolean {
  const hidden =
    (f.hiddenCategories as string[]).includes(a.category) || f.hiddenAlarmNames.includes(a.alarmName);
  if (!hidden) return false;
  const site = a.site.toUpperCase();
  const code = a.siteCode?.toUpperCase();
  return !f.exceptSites.some((e) => e === site || e === code);
}

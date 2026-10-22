// Personal UI settings of one user (users.uiPrefs): theme and how the alarm tables look.
// Pure part — the API validates and stores it, the web pages read it.

export const THEMES = ["blue", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** Alarm tables that have a column chooser. */
export const ALARM_TABLES = ["active", "cleared"] as const;
export type AlarmTable = (typeof ALARM_TABLES)[number];

/** Column ids of each alarm table (as used by the pages' ColumnDefs) with their labels. */
export const ALARM_COLUMNS: Record<AlarmTable, { id: string; label: string; required?: boolean }[]> =
  {
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

export interface UiPrefs {
  theme: Theme;
  alarms: {
    /** VIP / Nodality / Battery as small icons next to the site instead of columns + badge. */
    siteInfoIcons: boolean;
    /** Rows with the same site code are shown once; clicking the row expands the others. */
    groupBySite: boolean;
    /** Column ids hidden per table (required columns are never hidden). */
    hiddenColumns: Record<AlarmTable, string[]>;
  };
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: "blue",
  alarms: { siteInfoIcons: false, groupBySite: false, hiddenColumns: { active: [], cleared: [] } },
};

/** Any stored / submitted value → a complete, valid UiPrefs (unknown keys and ids dropped). */
export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const r = obj(raw);
  const a = obj(r.alarms);
  const hidden = obj(a.hiddenColumns);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const d = DEFAULT_UI_PREFS.alarms;
  return {
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_UI_PREFS.theme,
    alarms: {
      siteInfoIcons: bool(a.siteInfoIcons, d.siteInfoIcons),
      groupBySite: bool(a.groupBySite, d.groupBySite),
      hiddenColumns: Object.fromEntries(
        ALARM_TABLES.map((t) => {
          const allowed = new Set(ALARM_COLUMNS[t].filter((c) => !c.required).map((c) => c.id));
          const list = Array.isArray(hidden[t]) ? (hidden[t] as unknown[]) : [];
          return [t, [...new Set(list.filter((x): x is string => allowed.has(x as string)))]];
        }),
      ) as Record<AlarmTable, string[]>,
    },
  };
}

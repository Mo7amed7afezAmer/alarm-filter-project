"use client";

// Settings → Hourly reports (shared per office, hourly_settings; office admins and the super
// admin only — see components/hourly-prefs.tsx): which alarms show (Down and
// Environmental lists, saved from every processed report), the columns, the image sets "Export
// image" makes, the default sort and the colour rules (by age or office, on chosen columns).
import {
  CATEGORIES,
  DEFAULT_HOURLY_PREFS,
  HOURLY_COLUMNS,
  HOURLY_IMAGE_SETS,
  HOURLY_IMAGE_SETS_BY_OFFICE,
  HOURLY_ROWS_PER_IMAGE,
  HOURLY_SHEETS,
  hasRole,
  lighterColor,
  hourlyOfficeMode,
  type HourlyOfficeMode,
  officeColor,
  type Category,
  type HourlyColorRule,
  type HourlyColumnKey,
  type HourlyImageSet,
  type HourlyPrefs,
} from "@alarm/core";
import {
  ChevronDown,
  MapPin,
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppConfig } from "@/components/app-config";
import { api } from "@/components/hourly/client";
import { orderedColumns } from "@/components/hourly/hourly-table";
import { IMAGE_SET_NAME } from "@/components/hourly/table-image";
import { AccordionSection as Section } from "@/components/settings/accordion";
import { NoAccess, SectionHeader, Toggle } from "@/components/settings/section";
import { MultiSelect } from "@/components/hourly/multi-select";
import { useHourlyPrefs } from "@/components/hourly-prefs";
import { SiteList, VisibilityButton } from "@/components/types-visibility-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useHourly() {
  const { hp, update } = useHourlyPrefs();
  const set = (patch: Partial<HourlyPrefs>) => update((p) => ({ ...p, ...patch }));
  return { hp, set };
}

const SAVE_TEXT = { idle: "", saving: "Saving…", saved: "Saved", error: "Could not save" } as const;

/** Whose settings these are: the office's own, the default, or an office on the default. */
function ScopeNote() {
  const { meta, own, reset, saveState } = useHourlyPrefs();
  const key = meta.editKey;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <span className="min-w-0 flex-1">
        {key === "*" ? (
          <>
            <b>Default settings</b> — used by every office that has no settings of its own.
          </>
        ) : own ? (
          <>
            Settings of <b>{key}</b> — used by everyone in this office.
          </>
        ) : (
          <>
            <b>{key}</b> uses the default settings. Changing anything here gives it its own.
          </>
        )}
      </span>
      {own && key !== "*" && (
        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline"
          onClick={() => void reset()}
        >
          Use the default again
        </button>
      )}
      {saveState !== "idle" && (
        <span
          className={cn(
            "rounded-sm px-2 py-0.5 text-xs font-medium",
            saveState === "error" ? "bg-red-50 text-red-700" : "bg-white/70 text-sky-900",
          )}
        >
          {SAVE_TEXT[saveState]}
        </span>
      )}
    </div>
  );
}

const toggle = <T,>(list: T[], v: T, hide: boolean) =>
  hide ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v);

const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{children}</div>
);

// ---------------------------------------------------------------- alarms

interface AlarmName {
  name: string;
  section: "DOWN" | "ENV";
  category: string;
  lastCount: number;
  lastSeen: string;
  /** Alarm Text values seen with the name (Environmental: "BASE STATION EXTERNAL ALARM …"). */
  alarmTexts: string[];
}
interface Collect {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  finishedAt: string | null;
}

/** Saved alarm names (every processed report adds to them) + the collect job, polled while it runs. */
function useAlarmNames() {
  const [names, setNames] = useState<AlarmName[] | null>(null);
  const [collect, setCollect] = useState<Collect | null>(null);
  const [reports, setReports] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{
        data: AlarmName[];
        meta: { collect: Collect; collectReports: number };
      }>("/api/hourly-alarm-names");
      setNames(r.data);
      setCollect(r.meta.collect);
      setReports(r.meta.collectReports);
    } catch (e) {
      setError((e as Error).message);
      setNames((n) => n ?? []);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!collect?.running) return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [collect?.running, load]);
  const start = async () => {
    setError(null);
    try {
      const r = await api<{ meta: { collect: Collect } }>("/api/hourly-alarm-names/collect", {
        method: "POST",
      });
      setCollect(r.meta.collect);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Adds a name by hand (e.g. not in a report yet); the list reloads. */
  const add = async (name: string, section: AlarmName["section"]) => {
    await api("/api/hourly-alarm-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, section }),
    });
    await load();
  };
  return { names, collect, reports, error, start, add };
}

/** "Add alarm": saves a name in the shared list, in the chosen section. */
function AddName({
  onAdd,
}: {
  onAdd: (name: string, section: AlarmName["section"]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [section, setSection] = useState<AlarmName["section"]>("ENV");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await onAdd(text.trim(), section);
          setText("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        className="h-8 min-w-0 flex-1 bg-white uppercase"
        placeholder="Add an alarm by name"
        aria-label="Alarm name to add"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <select
        aria-label="Section"
        className="h-8 rounded-md border border-input bg-white px-2 text-sm"
        value={section}
        onChange={(e) => setSection(e.target.value as AlarmName["section"])}
      >
        <option value="DOWN">Down</option>
        <option value="ENV">Environmental</option>
      </select>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="bg-white"
        disabled={busy || !text.trim()}
      >
        <Plus className="h-4 w-4" /> Add
      </Button>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </form>
  );
}

const CAT_SELECT: Record<string, string> = {
  DOWN: "border-red-200 bg-red-50 text-red-800",
  POWER: "border-amber-200 bg-amber-50 text-amber-800",
  OTHER: "border-slate-200 bg-slate-100 text-slate-700",
};

/**
 * Alarm names of the hourly reports (saved from every processed report and by "Collect"), each
 * with its category (changeable), how often it came in the last report, site exceptions and
 * Shown / Hidden — the same layout as Settings → Display alarms. Saved with the office's
 * hourly settings as they change.
 */
function AlarmsCard() {
  const { role } = useAppConfig();
  const { hp, set } = useHourly();
  const { names, collect, reports, error, start, add } = useAlarmNames();
  const [q, setQ] = useState("");
  /** Down / Environmental = the sheets a name comes from; Power = its (changed) category. */
  const [section, setSection] = useState<"all" | AlarmName["section"] | "POWER">("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null);
  const hidden = new Set(hp.hiddenAlarms);
  const cats = hp.alarmCategories ?? {};
  const siteRules = hp.alarmSites ?? {};

  // names hidden / changed earlier but not saved in the list (yet) still show, so they can be undone
  const all = useMemo(() => {
    const list = names ?? [];
    const known = new Set(list.map((n) => n.name.toUpperCase()));
    const extra = [
      ...new Set([...hp.hiddenAlarms, ...Object.keys(cats), ...Object.keys(siteRules)]),
    ]
      .filter((h) => !known.has(h))
      .map((name): AlarmName => ({
        name,
        section: "ENV",
        category: "OTHER",
        lastCount: 0,
        lastSeen: "",
        alarmTexts: [],
      }));
    return [...list, ...extra];
  }, [names, hp.hiddenAlarms, cats, siteRules]);

  const key = (n: AlarmName) => n.name.toUpperCase();
  const isHidden = (n: AlarmName) => hidden.has(key(n));
  const sitesOf = (n: AlarmName) => siteRules[key(n)] ?? [];
  const catOf = (n: AlarmName) => cats[key(n)] ?? (n.category === "?" ? "OTHER" : n.category);
  const changedRow = (n: AlarmName) =>
    isHidden(n) || sitesOf(n).length > 0 || cats[key(n)] !== undefined;

  const setHidden = (list: AlarmName[], hide: boolean) => {
    let next = hp.hiddenAlarms;
    for (const n of list) next = toggle(next, key(n), hide);
    set({ hiddenAlarms: next });
  };
  const setCategory = (n: AlarmName, c: string) => {
    const rest = { ...cats };
    delete rest[key(n)];
    // the report's own category needs no entry
    set({ alarmCategories: c === n.category ? rest : { ...rest, [key(n)]: c as Category } });
  };
  const setSites = (n: AlarmName, sites: string[]) => {
    const rest = { ...siteRules };
    delete rest[key(n)];
    set({ alarmSites: sites.length ? { ...rest, [key(n)]: sites } : rest });
  };

  // the search matches the alarm name or an Alarm Text seen with it
  const term = q.trim().toUpperCase();
  const viaText = (n: AlarmName) =>
    term && !n.name.toUpperCase().includes(term)
      ? n.alarmTexts.find((t) => t.toUpperCase().includes(term))
      : undefined;
  const inSection = all.filter((n) =>
    section === "all" ? true : section === "POWER" ? catOf(n) === "POWER" : n.section === section,
  );
  const changedN = inSection.filter(changedRow).length;
  const rows = inSection.filter(
    (n) =>
      (!term || n.name.toUpperCase().includes(term) || !!viaText(n)) &&
      (!onlyChanged || changedRow(n)),
  );
  const exceptionN = Object.keys(siteRules).length;
  const recatN = Object.keys(cats).length;

  return (
    <Section
      title="Alarms"
      defaultOpen
      summary={
        [
          hp.hiddenAlarms.length && `${hp.hiddenAlarms.length} hidden`,
          recatN && `${recatN} re-categorised`,
          exceptionN && `${exceptionN} with site exceptions`,
          hp.hiddenSheets.length && `${hp.hiddenSheets.length} sheets off`,
          hp.hiddenCategories.length && `${hp.hiddenCategories.length} categories off`,
        ]
          .filter(Boolean)
          .join(" · ") || "everything shown"
      }
      description={
        <>
          Every alarm name seen in a processed report is kept here. Change its category, hide it, or
          use <b>Sites</b>: a hidden alarm still shows at those sites, a shown one is hidden there.
          Applies to the table, the images and Excel.
        </>
      }
      contentClassName="space-y-4"
      action={
        hasRole(role, "OPERATOR") && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 bg-white"
            disabled={collect?.running}
            onClick={() => void start()}
            title={`Read the last ${reports} reports and save their alarm names`}
          >
            {collect?.running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {collect?.running
                ? `Reading reports ${collect.done}/${collect.total || reports}`
                : `Collect from the last ${reports} reports`}
            </span>
          </Button>
        )
      }
    >
      {collect && !collect.running && collect.finishedAt && (
        <p className="text-xs text-slate-500">
          Last collect: {collect.done - collect.failed} of {collect.total} reports read
          {collect.failed > 0 && ` (${collect.failed} without a usable report file)`}.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {hp.hiddenCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Whole categories hidden (older setting): {hp.hiddenCategories.join(", ")}
          <button type="button" className="underline" onClick={() => set({ hiddenCategories: [] })}>
            Show them again
          </button>
        </div>
      )}
      <div>
        <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Alarm names (saved from the reports)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {/* sheets: the rows of unticked sheets are left out (none ticked = all sheets) */}
            <MultiSelect
              label="Sheets"
              className="w-40"
              placeholder="All sheets"
              allOption="All sheets"
              options={HOURLY_SHEETS.map((v) => ({ value: v }))}
              value={
                hp.hiddenSheets.length
                  ? HOURLY_SHEETS.filter((x) => !hp.hiddenSheets.includes(x))
                  : []
              }
              onChange={(v) =>
                set({
                  hiddenSheets: v.length ? HOURLY_SHEETS.filter((x) => !v.includes(x)) : [],
                })
              }
            />
            <select
              aria-label="Section"
              className="h-8 rounded-md border border-input bg-white px-2 text-sm"
              value={section}
              onChange={(e) => setSection(e.target.value as typeof section)}
            >
              <option value="all">Down + Environmental</option>
              <option value="DOWN">Down</option>
              <option value="ENV">Environmental</option>
              <option value="POWER">Power</option>
            </select>
            <select
              aria-label="Show"
              className="h-8 rounded-md border border-input bg-white px-2 text-sm"
              value={onlyChanged ? "changed" : "all"}
              onChange={(e) => setOnlyChanged(e.target.value === "changed")}
            >
              <option value="all">All alarms</option>
              <option value="changed">Changed ({changedN})</option>
            </select>
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or Alarm Text"
                className="h-8 bg-white pl-8"
              />
            </div>
          </div>
        </div>
        {names === null ? (
          <p className="text-sm text-slate-500">Loading alarm names…</p>
        ) : (
          <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {rows.map((n) => {
              const off = isHidden(n);
              const sites = sitesOf(n);
              const open = openName === n.name;
              const cat = catOf(n);
              const text = viaText(n);
              return (
                <div key={n.name} className={cn(off && !open && "bg-slate-50")}>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm" title={n.name}>
                      <span
                        className={cn(
                          "block truncate",
                          off ? "text-slate-400 line-through" : "text-slate-900",
                        )}
                      >
                        {n.name}
                        <span className="ml-1.5 text-[10px] font-medium text-slate-400">
                          {n.section === "DOWN" ? "DOWN SHEETS" : "ENVIRONMENTAL"}
                        </span>
                      </span>
                      {text && (
                        <span className="block truncate text-[11px] text-slate-400">
                          Alarm Text: {text}
                        </span>
                      )}
                    </span>
                    <select
                      aria-label={`Category of ${n.name}`}
                      title={
                        cats[key(n)]
                          ? `Changed (the report says ${n.category})`
                          : "Category from the report — change it here"
                      }
                      value={cat}
                      onChange={(e) => setCategory(n, e.target.value)}
                      className={cn(
                        "h-7 shrink-0 rounded-md border px-1.5 text-xs font-medium",
                        CAT_SELECT[cat],
                        cats[key(n)] && "ring-1 ring-brand",
                      )}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <span
                      className="hidden w-12 text-right text-xs tabular-nums text-slate-400 sm:inline"
                      title="Rows in the last report it was seen in"
                    >
                      {n.lastCount || ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenName(open ? null : n.name)}
                      aria-expanded={open}
                      title={off ? "Sites where it still shows" : "Sites where it is hidden"}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                        sites.length
                          ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                          : "border-slate-200 text-slate-500 hover:bg-slate-100",
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {sites.length
                        ? `${sites.length} site${sites.length === 1 ? "" : "s"}`
                        : "Sites"}
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
                      />
                    </button>
                    <VisibilityButton
                      shown={!off}
                      onClick={() => setHidden([n], !off)}
                      label={n.name}
                    />
                  </div>
                  {open && (
                    <div className="border-t border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                      <SiteList value={sites} hidden={off} onChange={(v) => setSites(n, v)} />
                    </div>
                  )}
                </div>
              );
            })}
            {!rows.length && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                {!all.length
                  ? "None saved yet — process a report or use Collect."
                  : onlyChanged
                    ? "No alarm is changed, hidden or has site exceptions."
                    : "No alarm names match."}
              </p>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-3 text-xs">
            <span className="text-slate-500">{rows.length} listed:</span>
            <button
              type="button"
              className="text-sky-700 hover:underline"
              onClick={() => setHidden(rows, false)}
            >
              Show all
            </button>
            <button
              type="button"
              className="text-sky-700 hover:underline"
              onClick={() => setHidden(rows, true)}
            >
              Hide all
            </button>
          </div>
        )}
      </div>
      <AddName onAdd={add} />
    </Section>
  );
}

// ---------------------------------------------------------------- columns

const COLUMN_HINT: Partial<Record<HourlyColumnKey, string>> = {
  siteNo: "1, 2, 3 … per site code — the last number is how many sites are down",
  siteAlarms: "how many alarms the same site code has in the list",
};

function ColumnsCard() {
  const { hp, set } = useHourly();
  const list = hp.tableColumns;
  const save = (keys: HourlyColumnKey[]) => set({ tableColumns: keys });
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    save(next);
  };
  const off = HOURLY_COLUMNS.filter((c) => !list.includes(c.key));

  return (
    <Section
      title="Columns"
      summary={`${list.length} of ${HOURLY_COLUMNS.length} shown`}
      description="Shown columns from left to right — the table and the images use the same list."
      contentClassName="grid gap-4 lg:grid-cols-2"
    >
      <div className="space-y-1">
        <Label>Shown ({list.length})</Label>
        <ol className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {orderedColumns(list).map((c, i) => (
            <li key={c.key} className="flex items-center gap-2 px-2 py-1 text-sm">
              <span className="w-5 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                {c.header}
                {COLUMN_HINT[c.key] && (
                  <span className="block text-[11px] text-slate-500">{COLUMN_HINT[c.key]}</span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Move ${c.header} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${c.header} down`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
                className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Hide ${c.header}`}
                disabled={list.length === 1}
                onClick={() => save(list.filter((k) => k !== c.key))}
                className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 pt-1 text-sm text-sky-700 underline"
          onClick={() => save(DEFAULT_HOURLY_PREFS.tableColumns)}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Default columns
        </button>
      </div>
      <div className="space-y-1">
        <Label>Hidden — click to add at the end</Label>
        <div className="flex flex-wrap gap-1.5">
          {off.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => save([...list, c.key])}
              title={COLUMN_HINT[c.key]}
              className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:border-brand hover:text-slate-900"
            >
              <Plus className="h-3.5 w-3.5" />
              {c.header}
            </button>
          ))}
          {!off.length && <p className="text-sm text-slate-500">Every column is shown.</p>}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- images + sort

const IMAGE_SET_HINT: Record<HourlyImageSet, string> = {
  down: "Down alarms.",
  downSites:
    "Down, all offices in one image, one row per site code (any one of its alarms) — shows how many sites are down.",
  env: "Environmental: Power and Other alarms.",
  envVipNodal: "Environmental alarms of VIP or Nodal sites only.",
  power: "Power alarms only, all offices together.",
};

const OFFICE_MODES: [HourlyOfficeMode, string][] = [
  ["all", "All offices in one image"],
  ["each", "One image per office"],
  ["groups", "Office groups"],
];

const modePatch = (m: HourlyOfficeMode) => ({ byOffice: m === "each", grouped: m === "groups" });

function ImagesCard() {
  const { hp, set } = useHourly();
  const setImage = (k: HourlyImageSet, patch: Partial<HourlyPrefs["images"][HourlyImageSet]>) =>
    set({ images: { ...hp.images, [k]: { ...hp.images[k], ...patch } } });

  return (
    <Section
      title="Images"
      summary={
        HOURLY_IMAGE_SETS.filter((k) => hp.images[k].enabled)
          .map(
            (k) =>
              IMAGE_SET_NAME[k] +
              { all: "", each: " (per office)", groups: " (office groups)" }[
                hourlyOfficeMode(hp.images[k])
              ],
          )
          .join(", ") || "no image sets"
      }
      description='The image sets "Export image" makes from the filtered rows. Each set can be turned off for one export in its window.'
      contentClassName="space-y-3"
    >
      {HOURLY_IMAGE_SETS.map((k) => {
        const img = hp.images[k];
        return (
          <div key={k} className="space-y-2 rounded-md border border-slate-200 px-3 py-2.5">
            <Toggle
              label={IMAGE_SET_NAME[k]}
              hint={IMAGE_SET_HINT[k]}
              checked={img.enabled}
              onChange={(v) => setImage(k, { enabled: v })}
            />
            {img.enabled && HOURLY_IMAGE_SETS_BY_OFFICE.includes(k) && (
              <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                {OFFICE_MODES.map(([m, label]) => (
                  <label key={m} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`office-${k}`}
                      checked={hourlyOfficeMode(img) === m}
                      onChange={() => setImage(k, modePatch(m))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {img.enabled && img.grouped && (
              <p className="text-xs text-slate-500">
                Offices are put together automatically: as many whole offices as fit in{" "}
                {hp.imageRowsPerPage} rows share one image; an office with more rows gets its own.
              </p>
            )}
          </div>
        );
      })}
      <label className="flex items-center justify-between gap-4 pt-1">
        <span className="text-sm font-medium text-slate-900">Rows per image</span>
        <select
          className="h-8 rounded-md border border-input bg-white px-2 text-sm"
          value={hp.imageRowsPerPage}
          onChange={(e) => set({ imageRowsPerPage: Number(e.target.value) })}
        >
          {HOURLY_ROWS_PER_IMAGE.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function SortCard() {
  const { hp, set } = useHourly();
  const options = [
    ["time", "Time", "Office, then newest alarm first."],
    ["code", "Site code", "Office, then site code — all alarms of one site sit together."],
  ] as const;
  return (
    <Section
      title="Sort"
      summary={hp.sort === "code" ? "by site code" : "by time"}
      description="Default order of the table and the images. Clicking a column header on the report still sorts by that column."
      contentClassName="grid gap-2 sm:grid-cols-2"
    >
      {options.map(([v, label, hint]) => (
        <label
          key={v}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm",
            hp.sort === v ? "border-brand bg-brand/10" : "border-slate-200 hover:bg-slate-100",
          )}
        >
          <input
            type="radio"
            name="sort"
            className="mt-1"
            checked={hp.sort === v}
            onChange={() => set({ sort: v })}
          />
          <span>
            <span className="block font-medium text-slate-900">{label}</span>
            <span className="block text-xs text-slate-500">{hint}</span>
          </span>
        </label>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------- colours

/** Offices of the Site Master sites the user can see (the office rules pick from them). */
function useOffices() {
  const [offices, setOffices] = useState<string[]>([]);
  useEffect(() => {
    api<{ meta: { offices: { office: string }[] } }>("/api/site-master?pageSize=1")
      .then((r) => setOffices(r.meta.offices.map((o) => o.office.toUpperCase())))
      .catch(() => setOffices([]));
  }, []);
  return offices;
}

/** "Whole row" or the chosen columns. */
function RuleColumns({
  value,
  onChange,
}: {
  value: HourlyColumnKey[];
  onChange: (v: HourlyColumnKey[]) => void;
}) {
  return (
    <details className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-input bg-white px-2.5 text-sm text-slate-700">
        {value.length ? `${value.length} column${value.length === 1 ? "" : "s"}` : "Whole row"}
        <ArrowDown className="h-3.5 w-3.5 text-slate-400 group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
        <label className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-slate-100">
          <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
          Whole row
        </label>
        {HOURLY_COLUMNS.map((c) => (
          <label
            key={c.key}
            className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-slate-100"
          >
            <input
              type="checkbox"
              checked={value.includes(c.key)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, c.key] : value.filter((k) => k !== c.key))
              }
            />
            {c.header}
          </label>
        ))}
      </div>
    </details>
  );
}

function ColorsCard() {
  const { hp, set } = useHourly();
  const colors = hp.colors;
  // hours are edited locally and saved on blur, so typing "12" does not save "1" first
  const [hours, setHours] = useState<Record<number, string>>({});
  useEffect(() => setHours({}), [colors.rules]);
  const save = (rules: HourlyColorRule[]) => set({ colors: { ...colors, rules } });
  const patch = (i: number, p: Partial<HourlyColorRule>) =>
    save(colors.rules.map((r, j) => (j === i ? ({ ...r, ...p } as HourlyColorRule) : r)));

  return (
    <Section
      title="Colours"
      summary={
        !colors.enabled
          ? "off"
          : `${colors.rules.length} age rule${colors.rules.length === 1 ? "" : "s"}`
      }
      description="Colour rows by alarm age (report mail time − Alarm Time), on the whole row or chosen columns; the highest period reached wins, otherwise the office colour below. Rows with an invalid NE clock never get an age colour."
      contentClassName="space-y-3"
    >
      <Toggle
        label="Use colour rules"
        checked={colors.enabled}
        onChange={(v) => set({ colors: { ...colors, enabled: v } })}
      />
      <div className={cn("space-y-2", !colors.enabled && "pointer-events-none opacity-50")}>
        {colors.rules.map((r, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm"
          >
            <>
              <span className="w-14 text-slate-500">Age</span>
              <span className="text-slate-600">older than</span>
              <Input
                type="number"
                min={0.25}
                max={720}
                step={0.25}
                aria-label="Hours"
                className="h-8 w-20 bg-white"
                value={hours[i] ?? String(r.hours)}
                onChange={(e) => setHours({ ...hours, [i]: e.target.value })}
                onBlur={() => {
                  const h = Number(hours[i]);
                  if (hours[i] !== undefined && h > 0 && h <= 720) patch(i, { hours: h });
                  else setHours({});
                }}
              />
              <span className="text-slate-600">hours</span>
            </>
            <span className="text-slate-400">→</span>
            <input
              type="color"
              aria-label="Colour"
              className="h-8 w-12 cursor-pointer rounded-sm border border-slate-300 bg-white p-0.5"
              value={`#${r.color}`}
              onChange={(e) => patch(i, { color: e.target.value.slice(1).toUpperCase() })}
            />
            <RuleColumns value={r.columns} onChange={(columns) => patch(i, { columns })} />
            <span
              className="rounded-sm px-2 py-0.5 text-xs font-medium text-slate-900"
              style={{ background: `#${r.color}` }}
            >
              sample
            </span>
            <button
              type="button"
              aria-label="Remove rule"
              onClick={() => save(colors.rules.filter((_, j) => j !== i))}
              className="ml-auto rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!colors.rules.length && (
          <p className="text-sm text-slate-500">No rules — rows keep their office colour.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            disabled={colors.rules.length >= 30}
            onClick={() => {
              const last = Math.max(
                0,
                ...colors.rules.flatMap((r) => (r.kind === "age" ? [r.hours] : [])),
              );
              save([
                ...colors.rules,
                { kind: "age", hours: last + 3, color: last ? "F87171" : "FCA5A5", columns: [] },
              ]);
            }}
          >
            <Plus className="h-4 w-4" /> Age rule
          </Button>
        </div>
      </div>
      <OfficeColorList />
    </Section>
  );
}

/**
 * Every office with the colour of its Office cell (user request 2026-10-29), and whether its
 * other cells get a lighter shade of it. An office left on "Default" keeps the built-in office
 * colour on the whole row. Rules above still win.
 */
function OfficeColorList() {
  const { hp, set } = useHourly();
  const offices = useOffices();
  const colors = hp.colors;
  const list = colors.offices ?? {};
  // offices with a saved colour that are not in Site Master any more stay listed
  const names = [...new Set([...offices, ...Object.keys(list)])].sort();
  const setColor = (office: string, color: string | null) => {
    const next = { ...list };
    if (color) next[office] = color;
    else delete next[office];
    set({ colors: { ...colors, offices: next } });
  };
  return (
    <div className="space-y-2 border-t border-slate-200 pt-3">
      <div className="text-sm font-medium text-slate-900">Office colours</div>
      <p className="text-xs text-slate-500">
        The colour of each office&apos;s Office cell. Offices left on Default keep their usual
        colour on the whole row.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={colors.officeRowTint !== false}
          onChange={(e) => set({ colors: { ...colors, officeRowTint: e.target.checked } })}
        />
        Colour the office&apos;s whole row in a lighter shade of the same colour
      </label>
      {!names.length ? (
        <p className="text-sm text-slate-500">No Site Master offices to colour.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {names.map((o) => {
            const own = list[o];
            const shown = own ?? officeColor(o) ?? "FFFFFF";
            return (
              <div
                key={o}
                className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
              >
                <span
                  className="min-w-0 flex-1 truncate rounded-sm px-1.5 py-0.5 text-slate-900"
                  style={own ? { backgroundColor: `#${own}`, color: "#0f172a" } : undefined}
                >
                  {o}
                </span>
                {own && colors.officeRowTint !== false && (
                  <span
                    title="Rest of the row"
                    className="h-5 w-5 shrink-0 rounded-sm border border-slate-300"
                    style={{ backgroundColor: `#${lighterColor(own)}` }}
                  />
                )}
                <input
                  type="color"
                  aria-label={`${o}: colour`}
                  className="h-7 w-9 shrink-0 cursor-pointer rounded-sm border border-slate-300 bg-white p-0.5"
                  value={`#${shown}`}
                  onChange={(e) => setColor(o, e.target.value.slice(1).toUpperCase())}
                />
                {own ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-slate-500 hover:text-slate-900"
                    onClick={() => setColor(o, null)}
                  >
                    Default
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">Default</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HourlySettings() {
  const { set } = useHourly();
  const { canEdit } = useHourlyPrefs();
  if (!canEdit)
    return (
      <>
        <SectionHeader title="Hourly reports" />
        <NoAccess who="office admins and the super admin" />
      </>
    );
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Hourly reports"
          subtitle="Which alarms and columns the hourly report shows, the images it makes and its colours — shared by everyone in the office."
        />
        <Button
          size="sm"
          variant="outline"
          className="bg-white"
          onClick={() => set(DEFAULT_HOURLY_PREFS)}
        >
          <RotateCcw className="h-4 w-4" /> Reset all
        </Button>
      </div>
      <ScopeNote />
      <div className="space-y-3">
        <AlarmsCard />
        <ColumnsCard />
        <ImagesCard />
        <SortCard />
        <ColorsCard />
      </div>
    </>
  );
}

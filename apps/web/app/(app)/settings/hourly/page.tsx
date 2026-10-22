"use client";

import {
  CATEGORIES,
  DEFAULT_HOURLY_PREFS,
  HOURLY_COLUMNS,
  HOURLY_ROWS_PER_IMAGE,
  HOURLY_SHEETS,
  HOURLY_SPLIT_MODES,
  hourlyCellFill,
  hourlyCellText,
  hourlySortFor,
  sortHourlyRows,
  splitHourlyRows,
  visibleHourlyRows,
  type HourlyAgeRule,
  type HourlyColumnKey,
  type HourlyPrefs,
  type HourlyRow,
  type HourlySplitMode,
} from "@alarm/core";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type ReportItem } from "@/components/hourly/client";
import { orderedColumns } from "@/components/hourly/hourly-table";
import { SPLIT_LABEL } from "@/components/hourly/table-image";
import { SectionHeader, Toggle } from "@/components/settings/section";
import { useUiPrefs } from "@/components/ui-prefs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useHourly() {
  const { prefs, update } = useUiPrefs();
  const set = (patch: Partial<HourlyPrefs>) => update((p) => ({ ...p, hourly: { ...p.hourly, ...patch } }));
  return { hp: prefs.hourly, set };
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        on ? "border-brand bg-brand/10 text-slate-900" : "border-slate-200 text-slate-400 line-through hover:bg-slate-100",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border",
          on ? "border-brand bg-brand text-white" : "border-slate-300",
        )}
      >
        {on && <Check className="h-3 w-3" />}
      </span>
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T, hide: boolean) => (hide ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));

// ---------------------------------------------------------------- alarm types

/** Alarm names (+ counts) of the newest processed report, for the hide list. */
function useLatestAlarmNames() {
  const [names, setNames] = useState<{ value: string; count: number }[] | null>(null);
  const [source, setSource] = useState<ReportItem | null>(null);
  useEffect(() => {
    (async () => {
      const list = await api<{ data: ReportItem[] }>("/api/hourly-reports?page=1");
      const done = list.data.find((r) => r.status === "done");
      if (!done) return setNames([]);
      setSource(done);
      const r = await api<{ meta: { facets: { alarm: { value: string; count: number }[] } } }>(
        `/api/hourly-reports/${encodeURIComponent(done.gmailId)}/rows?limit=1&facets=1`,
      );
      setNames(r.meta.facets.alarm);
    })().catch(() => setNames([]));
  }, []);
  return { names, source };
}

function TypesCard() {
  const { hp, set } = useHourly();
  const { names, source } = useLatestAlarmNames();
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState("");
  const hidden = new Set(hp.hiddenAlarms);
  const all = useMemo(() => {
    const m = new Map((names ?? []).map((n) => [n.value.toUpperCase(), n.count]));
    for (const h of hp.hiddenAlarms) if (!m.has(h)) m.set(h, 0);
    return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => (a.value < b.value ? -1 : 1));
  }, [names, hp.hiddenAlarms]);
  const shown = all.filter((n) => !q || n.value.includes(q.trim().toUpperCase()));
  const setAlarm = (name: string, hide: boolean) => set({ hiddenAlarms: toggle(hp.hiddenAlarms, name, hide) });

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Alarm types</CardTitle>
        <p className="text-sm text-slate-500">
          Unticked types are left out of the table, the images, Excel and PDF.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Sheets</div>
          <div className="flex flex-wrap gap-2">
            {HOURLY_SHEETS.map((s) => {
              const on = !hp.hiddenSheets.includes(s);
              return (
                <Chip key={s} on={on} onClick={() => set({ hiddenSheets: toggle(hp.hiddenSheets, s, on) })}>
                  {s.replace("_", " ")}
                </Chip>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">A Down alarm seen in several sheets stays while one of them is ticked.</p>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Categories</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = !hp.hiddenCategories.includes(c);
              return (
                <Chip key={c} on={on} onClick={() => set({ hiddenCategories: toggle(hp.hiddenCategories, c, on) })}>
                  {c}
                </Chip>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Alarms {hidden.size > 0 && <span className="normal-case text-amber-700">· {hidden.size} hidden</span>}
            </div>
            {hidden.size > 0 && (
              <button type="button" className="text-sm text-sky-700 underline" onClick={() => set({ hiddenAlarms: [] })}>
                Show all alarms
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="bg-white pl-8" placeholder="Search alarms" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) setAlarm(custom.trim().toUpperCase(), true);
                setCustom("");
              }}
            >
              <Input
                className="w-56 bg-white"
                placeholder="Hide an alarm by name"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" className="h-9 bg-white">
                Hide
              </Button>
            </form>
          </div>
          {names === null ? (
            <p className="text-sm text-slate-500">Loading alarm names…</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                {source
                  ? `Names and counts from the newest processed report (${source.fileName}).`
                  : "No processed report yet — hide alarms by name, or process a report to pick from its list."}
              </p>
              <div className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-1 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((n) => {
                  const on = !hidden.has(n.value);
                  return (
                    <label
                      key={n.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-100",
                        !on && "text-slate-400 line-through",
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => setAlarm(n.value, on)} />
                      <span className="min-w-0 flex-1 truncate" title={n.value}>
                        {n.value}
                      </span>
                      {n.count > 0 && <span className="tabular-nums text-xs text-slate-400">{n.count}</span>}
                    </label>
                  );
                })}
                {!shown.length && <p className="px-2 py-1 text-sm text-slate-500">No alarm matches.</p>}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- columns

type ColumnTarget = "tableColumns" | "imageColumns";
const COLUMN_TARGETS: Record<ColumnTarget, string> = {
  tableColumns: "Table, Excel & PDF",
  imageColumns: "WhatsApp images",
};
const COLUMN_HINT: Partial<Record<HourlyColumnKey, string>> = {
  siteNo: "1, 2, 3 … per site code — the last number is how many sites are down",
  siteAlarms: "how many alarms the same site code has in the list",
};

function ColumnsCard() {
  const { hp, set } = useHourly();
  const [target, setTarget] = useState<ColumnTarget>("tableColumns");
  const list = hp[target];
  const save = (keys: HourlyColumnKey[]) => set({ [target]: keys } as Partial<HourlyPrefs>);
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    save(next);
  };
  const off = HOURLY_COLUMNS.filter((c) => !list.includes(c.key));

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Columns and order</CardTitle>
          <p className="text-sm text-slate-500">Shown columns from left to right. The images have their own set.</p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5 text-sm">
          {(Object.keys(COLUMN_TARGETS) as ColumnTarget[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTarget(t)}
              className={cn("rounded-md px-3 py-1", t === target ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {COLUMN_TARGETS[t]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Shown ({list.length})</div>
          <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {orderedColumns(list).map((c, i) => (
              <li key={c.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="w-5 text-right tabular-nums text-xs text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  {c.header}
                  {COLUMN_HINT[c.key] && <span className="block text-[11px] text-slate-500">{COLUMN_HINT[c.key]}</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Move ${c.header} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${c.header} down`}
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Hide ${c.header}`}
                  disabled={list.length === 1}
                  onClick={() => save(list.filter((k) => k !== c.key))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 pt-1 text-sm text-sky-700 underline"
            onClick={() => save(DEFAULT_HOURLY_PREFS[target])}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Default columns
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Hidden — click to add at the end</div>
          <div className="flex flex-wrap gap-2">
            {off.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => save([...list, c.key])}
                title={COLUMN_HINT[c.key]}
                className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:border-brand hover:text-slate-900"
              >
                <Plus className="h-3.5 w-3.5" />
                {c.header}
              </button>
            ))}
            {!off.length && <p className="text-sm text-slate-500">Every column is shown.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- age colours

function AgeCard() {
  const { hp, set } = useHourly();
  const age = hp.ageColors;
  // edited locally and saved on blur, so typing "12" does not reorder / merge rules mid-way
  const [rules, setRules] = useState<{ hours: string; color: string }[]>([]);
  useEffect(
    () => setRules(age.rules.map((r) => ({ hours: String(r.hours), color: r.color }))),
    [age.rules],
  );
  const commit = (next = rules) =>
    set({
      ageColors: {
        ...age,
        rules: next.map((r) => ({ hours: Number(r.hours), color: r.color }) as HourlyAgeRule),
      },
    });
  const setAge = (patch: Partial<HourlyPrefs["ageColors"]>) => set({ ageColors: { ...age, ...patch } });

  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Color by alarm age</CardTitle>
        <p className="text-sm text-slate-500">
          Age = time the report mail arrived − Alarm Time. The highest period an alarm reaches gives its color
          (over the office color). Rows with an invalid NE clock are never colored.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle label="Color old alarms" checked={age.enabled} onChange={(v) => setAge({ enabled: v })} />
        <div className={cn("space-y-4", !age.enabled && "pointer-events-none opacity-50")}>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">Older than</span>
                <Input
                  type="number"
                  min={0.25}
                  max={720}
                  step={0.25}
                  aria-label="Hours"
                  className="w-24 bg-white"
                  value={r.hours}
                  onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                  onBlur={() => commit()}
                />
                <span className="text-slate-600">hours →</span>
                <input
                  type="color"
                  aria-label="Color"
                  className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                  value={`#${r.color}`}
                  onChange={(e) => {
                    const next = rules.map((x, j) => (j === i ? { ...x, color: e.target.value.slice(1).toUpperCase() } : x));
                    setRules(next);
                    commit(next);
                  }}
                />
                <span className="rounded px-2 py-1 text-xs font-medium text-slate-900" style={{ background: `#${r.color}` }}>
                  sample
                </span>
                <button
                  type="button"
                  aria-label="Remove period"
                  onClick={() => commit(rules.filter((_, j) => j !== i))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              disabled={rules.length >= 10}
              onClick={() => {
                const last = Math.max(0, ...rules.map((r) => Number(r.hours) || 0));
                commit([...rules, { hours: String(last + 3), color: last ? "F87171" : "FCA5A5" }]);
              }}
            >
              <Plus className="h-4 w-4" /> Add period
            </Button>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">What to color</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["row", "The whole row"],
                  ["columns", "Only these columns"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" name="age-target" checked={age.target === v} onChange={() => setAge({ target: v })} />
                  {label}
                </label>
              ))}
            </div>
            {age.target === "columns" && (
              <div className="flex flex-wrap gap-2">
                {HOURLY_COLUMNS.map((c) => {
                  const on = age.columns.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setAge({ columns: on ? age.columns.filter((k) => k !== c.key) : [...age.columns, c.key] })
                      }
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-sm",
                        on ? "border-brand bg-brand/10 text-slate-900" : "border-slate-200 text-slate-500 hover:bg-slate-100",
                      )}
                    >
                      {c.header}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- rows + grouping

function RowsCard() {
  const { hp, set } = useHourly();
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Rows and grouping</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Toggle
          label="Sort rows by site code"
          hint="Office, then site code, then newest alarm — all alarms of one site sit together. Clicking a column header on the report still sorts by that column."
          checked={hp.sortBySite}
          onChange={(v) => set({ sortBySite: v })}
        />
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-900">Separate images, Excel sheets and PDF sections</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {HOURLY_SPLIT_MODES.map((m: HourlySplitMode) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  hp.split.mode === m ? "border-brand bg-brand/10 text-slate-900" : "border-slate-200 text-slate-600",
                )}
              >
                <input
                  type="radio"
                  name="split"
                  checked={hp.split.mode === m}
                  onChange={() => set({ split: { ...hp.split, mode: m } })}
                />
                {SPLIT_LABEL[m]}
              </label>
            ))}
          </div>
        </div>
        <Toggle
          label="Separate per office"
          hint="Each office gets its own images, Excel sheet(s) and PDF pages (unknown site codes last)."
          checked={hp.split.byOffice}
          onChange={(v) => set({ split: { ...hp.split, byOffice: v } })}
        />
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-slate-900">Rows per WhatsApp image</span>
          <select
            className="h-9 rounded-md border border-input bg-white px-2 text-sm"
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- preview

const base: Omit<HourlyRow, "id" | "alarmTime" | "code" | "office" | "category" | "alarmName" | "sheet"> = {
  alarmNumber: "1",
  alarmText: "",
  dn: "",
  objectClass: "",
  name: "",
  siteName: "",
  nodality: "",
  vip: false,
  siteType: "SHELTER",
  powerSource: "",
  battery: "4H",
  phone: "",
  supplementaryInfo: "",
  region: "DE",
  technologies: ["2G"],
  sheets: [],
  clockInvalid: false,
  unmatched: false,
};
const sample = (id: number, alarmTime: string, code: string, office: string, category: HourlyRow["category"], alarmName: string): HourlyRow => ({
  ...base,
  id,
  alarmTime,
  code,
  office,
  category,
  alarmName,
  alarmText: alarmName,
  siteName: `BH-SITE-${code.slice(0, 4)}`,
  name: `S_BH-SITE_${code}`,
  sheet: category === "DOWN" ? "2G_Down" : "Environmental",
  sheets: [category === "DOWN" ? "2G_Down" : "Environmental"],
});
const SAMPLE_REF = "2026-10-13 12:00:00";
const SAMPLE_ROWS = [
  sample(1, "2026-10-13 11:20:00", "0101DE", "KAFR EL DAWAR", "DOWN", "BCCH MISSING"),
  sample(2, "2026-10-13 08:10:00", "0207DE", "KAFR EL DAWAR", "POWER", "MAIN POWER CUT OFF"),
  sample(3, "2026-10-13 05:30:00", "0101DE", "KAFR EL DAWAR", "DOWN", "CELL FAULTY"),
  sample(4, "2026-10-12 22:00:00", "0333DE", "DAMANHOUR", "OTHER", "DOOR OPEN"),
];

function PreviewCard() {
  const { hp } = useHourly();
  const cols = orderedColumns(hp.tableColumns);
  const rows = sortHourlyRows(visibleHourlyRows(SAMPLE_ROWS, hp), hourlySortFor(hp));
  const groups = splitHourlyRows(rows, hp.split);
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <p className="text-sm text-slate-500">
          Sample rows, report time {SAMPLE_REF} (Excel / PDF look){!rows.length && " — every sample row is hidden"}.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map((g) => (
          <div key={g.label || "all"} className="space-y-1">
            {g.label && <div className="text-xs font-semibold text-slate-700">{g.label}</div>}
            <div className="overflow-x-auto rounded border border-slate-300">
              <table className="w-full border-collapse text-xs text-slate-900">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} className="whitespace-nowrap border border-slate-400 bg-[#E2E8F0] px-2 py-1 text-left text-[#0f172a]">
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      {cols.map((c) => {
                        const color = hourlyCellFill(r, c.key, SAMPLE_REF, hp);
                        return (
                          <td
                            key={c.key}
                            className="whitespace-nowrap border border-slate-400 px-2 py-1 text-[#0f172a]"
                            style={{ background: color ? `#${color}` : "#ffffff" }}
                          >
                            {hourlyCellText(r, c.key)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function HourlySettings() {
  const { set } = useHourly();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Hourly reports"
          subtitle="How the hourly report table, WhatsApp images, Excel and PDF look for you — saved to your account only."
        />
        <Button size="sm" variant="outline" className="bg-white" onClick={() => set(DEFAULT_HOURLY_PREFS)}>
          <RotateCcw className="h-4 w-4" /> Reset all
        </Button>
      </div>
      <PreviewCard />
      <TypesCard />
      <ColumnsCard />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <RowsCard />
        <AgeCard />
      </div>
    </>
  );
}

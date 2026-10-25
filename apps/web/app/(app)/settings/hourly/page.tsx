"use client";

// Settings → Hourly reports (per user, users.uiPrefs.hourly): which alarms show (Down and
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
  officeColor,
  type HourlyColorRule,
  type HourlyColumnKey,
  type HourlyImageSet,
  type HourlyPrefs,
} from "@alarm/core";
import {
  ArrowDown,
  ArrowUp,
  Check,
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
import { SectionHeader, Toggle } from "@/components/settings/section";
import { useUiPrefs } from "@/components/ui-prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useHourly() {
  const { prefs, update } = useUiPrefs();
  const set = (patch: Partial<HourlyPrefs>) =>
    update((p) => ({ ...p, hourly: { ...p.hourly, ...patch } }));
  return { hp: prefs.hourly, set };
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
        on
          ? "border-brand bg-brand/10 text-slate-900"
          : "border-slate-200 text-slate-400 line-through hover:bg-slate-100",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-sm border",
          on ? "border-brand bg-brand text-white" : "border-slate-300",
        )}
      >
        {on && <Check className="h-3 w-3" />}
      </span>
      {children}
    </button>
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
  return { names, collect, reports, error, start };
}

function NameList({
  title,
  names,
  q,
  hidden,
  onSet,
}: {
  title: string;
  names: AlarmName[];
  q: string;
  hidden: Set<string>;
  onSet: (names: string[], hide: boolean) => void;
}) {
  // the search matches the alarm name or an Alarm Text seen with it
  const term = q.trim().toUpperCase();
  const viaText = (n: AlarmName) =>
    term && !n.name.includes(term)
      ? n.alarmTexts.find((t) => t.toUpperCase().includes(term))
      : undefined;
  const shown = names.filter((n) => !term || n.name.includes(term) || !!viaText(n));
  const off = names.filter((n) => hidden.has(n.name.toUpperCase())).length;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>
          {title} <span className="normal-case text-slate-400">· {names.length}</span>
          {off > 0 && <span className="normal-case text-amber-700"> · {off} hidden</span>}
        </Label>
        <span className="flex gap-2 text-xs">
          <button
            type="button"
            className="text-sky-700 hover:underline"
            onClick={() =>
              onSet(
                shown.map((n) => n.name),
                false,
              )
            }
          >
            Show all
          </button>
          <button
            type="button"
            className="text-sky-700 hover:underline"
            onClick={() =>
              onSet(
                shown.map((n) => n.name),
                true,
              )
            }
          >
            Hide all
          </button>
        </span>
      </div>
      <div className="max-h-72 space-y-px overflow-y-auto rounded-md border border-slate-200 p-1">
        {shown.map((n) => {
          const on = !hidden.has(n.name.toUpperCase());
          return (
            <label
              key={n.name}
              title={`${n.name} · ${n.category} · last seen ${new Date(n.lastSeen).toLocaleString("en-GB")}`}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-slate-100",
                !on && "text-slate-400 line-through",
              )}
            >
              <input type="checkbox" checked={on} onChange={() => onSet([n.name], on)} />
              <span className="min-w-0 flex-1 truncate">
                {n.name}
                {viaText(n) && (
                  <span className="block truncate text-[11px] text-slate-400">
                    Alarm Text: {viaText(n)}
                  </span>
                )}
              </span>
              {n.section === "ENV" && (
                <span className="text-[10px] font-semibold text-slate-400">{n.category}</span>
              )}
              <span className="tabular-nums text-xs text-slate-400">{n.lastCount}</span>
            </label>
          );
        })}
        {!shown.length && (
          <p className="px-2 py-1 text-sm text-slate-500">
            {names.length ? "No alarm matches." : "None saved yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function AlarmsCard() {
  const { role } = useAppConfig();
  const { hp, set } = useHourly();
  const { names, collect, reports, error, start } = useAlarmNames();
  const [q, setQ] = useState("");
  const hidden = new Set(hp.hiddenAlarms);
  // names hidden earlier but not saved in the list (yet) still show, so they can be un-hidden
  const lists = useMemo(() => {
    const all = names ?? [];
    const known = new Set(all.map((n) => n.name.toUpperCase()));
    const extra: AlarmName[] = hp.hiddenAlarms
      .filter((h) => !known.has(h))
      .map((name) => ({
        name,
        section: "ENV",
        category: "?",
        lastCount: 0,
        lastSeen: "",
        alarmTexts: [],
      }));
    return {
      down: all.filter((n) => n.section === "DOWN"),
      env: [...all.filter((n) => n.section === "ENV"), ...extra],
    };
  }, [names, hp.hiddenAlarms]);
  const setNames = (list: string[], hide: boolean) => {
    let next = hp.hiddenAlarms;
    for (const n of list) next = toggle(next, n.toUpperCase(), hide);
    set({ hiddenAlarms: next });
  };

  return (
    <Section
      title="Alarms"
      defaultOpen
      summary={
        hp.hiddenAlarms.length + hp.hiddenSheets.length + hp.hiddenCategories.length
          ? `${hp.hiddenAlarms.length} alarms, ${hp.hiddenSheets.length} sheets, ${hp.hiddenCategories.length} categories hidden`
          : "everything shown"
      }
      description="Unticked alarms are left out of the table and the images. The lists keep every alarm name seen in a processed report."
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
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <Label>Sheets</Label>
          <div className="flex flex-wrap gap-1.5">
            {HOURLY_SHEETS.map((s) => {
              const on = !hp.hiddenSheets.includes(s);
              return (
                <Chip
                  key={s}
                  on={on}
                  onClick={() => set({ hiddenSheets: toggle(hp.hiddenSheets, s, on) })}
                >
                  {s.replace("_", " ")}
                </Chip>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Categories</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const on = !hp.hiddenCategories.includes(c);
              return (
                <Chip
                  key={c}
                  on={on}
                  onClick={() => set({ hiddenCategories: toggle(hp.hiddenCategories, c, on) })}
                >
                  {c}
                </Chip>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
        <Input
          className="h-8 bg-white pl-8"
          placeholder="Search alarm name or Alarm Text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {names === null ? (
        <p className="text-sm text-slate-500">Loading alarm names…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <NameList title="Down" names={lists.down} q={q} hidden={hidden} onSet={setNames} />
          <NameList
            title="Environmental (Power / Other)"
            names={lists.env}
            q={q}
            hidden={hidden}
            onSet={setNames}
          />
        </div>
      )}
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

function ImagesCard() {
  const { hp, set } = useHourly();
  const setImage = (k: HourlyImageSet, patch: Partial<HourlyPrefs["images"][HourlyImageSet]>) =>
    set({ images: { ...hp.images, [k]: { ...hp.images[k], ...patch } } });

  return (
    <Section
      title="Images"
      summary={
        HOURLY_IMAGE_SETS.filter((k) => hp.images[k].enabled)
          .map((k) => IMAGE_SET_NAME[k] + (hp.images[k].byOffice ? " (per office)" : ""))
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
                {(
                  [
                    [false, "All offices in one image"],
                    [true, "One image per office"],
                  ] as const
                ).map(([v, label]) => (
                  <label key={label} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`office-${k}`}
                      checked={img.byOffice === v}
                      onChange={() => setImage(k, { byOffice: v })}
                    />
                    {label}
                  </label>
                ))}
              </div>
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
  const offices = useOffices();
  const colors = hp.colors;
  // hours are edited locally and saved on blur, so typing "12" does not save "1" first
  const [hours, setHours] = useState<Record<number, string>>({});
  useEffect(() => setHours({}), [colors.rules]);
  const save = (rules: HourlyColorRule[]) => set({ colors: { ...colors, rules } });
  const patch = (i: number, p: Partial<HourlyColorRule>) =>
    save(colors.rules.map((r, j) => (j === i ? ({ ...r, ...p } as HourlyColorRule) : r)));
  const used = new Set(colors.rules.flatMap((r) => (r.kind === "office" ? [r.office] : [])));
  const freeOffice = offices.find((o) => !used.has(o));

  return (
    <Section
      title="Colours"
      summary={
        !colors.enabled
          ? "off"
          : `${colors.rules.length} rule${colors.rules.length === 1 ? "" : "s"}`
      }
      description="Colour rows by alarm age (report mail time − Alarm Time) or by office, on the whole row or chosen columns. An office rule wins over an age rule; among age rules the highest period reached wins; otherwise the office's usual colour. Rows with an invalid NE clock never get an age colour."
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
            {r.kind === "age" ? (
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
            ) : (
              <>
                <span className="w-14 text-slate-500">Office</span>
                <select
                  aria-label="Office"
                  className="h-8 min-w-40 rounded-md border border-input bg-white px-2"
                  value={r.office}
                  onChange={(e) => patch(i, { office: e.target.value })}
                >
                  {!offices.includes(r.office) && <option value={r.office}>{r.office}</option>}
                  {offices.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </>
            )}
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
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            disabled={colors.rules.length >= 30 || !freeOffice}
            onClick={() =>
              freeOffice &&
              save([
                ...colors.rules,
                {
                  kind: "office",
                  office: freeOffice,
                  color: officeColor(freeOffice) ?? "BFDBFE",
                  columns: ["office"],
                },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Office rule
          </Button>
        </div>
      </div>
    </Section>
  );
}

export default function HourlySettings() {
  const { set } = useHourly();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Hourly reports"
          subtitle="Which alarms and columns the hourly report shows, the images it makes and its colours — saved to your account only."
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

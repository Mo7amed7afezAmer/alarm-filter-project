"use client";

import {
  CATEGORIES,
  HOURLY_SHEETS,
  filterHourlyRows,
  hourlyCellFill,
  hourlyFacets,
  hourlyHiddenCount,
  hourlySiteCount,
  hourlySortFor,
  numberSites,
  officeColor,
  sortHourlyRows,
  visibleHourlyRows,
  wallClockOf,
  type HourlyColumnKey,
  type HourlyMeta,
  type HourlyRow,
} from "@alarm/core";
import {
  ChevronDown,
  EyeOff,
  FilterX,
  GitCompare,
  Loader2,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { Field, TextFilter } from "@/components/filters";
import {
  api,
  ApiError,
  loadAllRows,
  processReport,
  useHourlyUrl,
  waitForReport,
  type ReportItem,
} from "@/components/hourly/client";
import { ColumnChooser, HourlyTable, useColumnPrefs } from "@/components/hourly/hourly-table";
import { MultiSelect } from "@/components/hourly/multi-select";
import { TableImageButton } from "@/components/hourly/table-image";
import { useUiPrefs } from "@/components/ui-prefs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS_KEY = "hourly.filtersOpen";

/** Filters open / folded — remembered in this browser only (a convenience, safe to lose). */
function useFiltersOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(FILTERS_KEY) === "0") setOpen(false);
    } catch {
      /* storage blocked: stay open */
    }
  }, []);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(FILTERS_KEY, v ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  return [open, set];
}

/** Height / text of the filter controls (same as the multi-selects). */
const compact = "h-8 text-sm";

type State =
  | { kind: "loading" }
  | { kind: "needs-process" }
  | { kind: "processing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: HourlyRow[]; meta: HourlyMeta };

function ResultsView({ gmailId }: { gmailId: string }) {
  const { timeZone, role } = useAppConfig();
  const canProcess = role !== "VIEWER";
  // Office users only ever see their own office's rows — the filter is for the super admin.
  const pickOffice = role === "SUPER_ADMIN";
  const hp = useUiPrefs().prefs.hourly;
  const defaultSort = useMemo(() => hourlySortFor(hp), [hp]);
  const { filters, sort, setMany, setOne, setSort, clear, active } = useHourlyUrl(defaultSort);
  const cols = useColumnPrefs();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showFilters, setShowFilters] = useFiltersOpen();
  const [reports, setReports] = useState<ReportItem[]>([]);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { rows, meta } = await loadAllRows(gmailId);
      setState({ kind: "ready", rows, meta });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setState({ kind: "needs-process" });
      else setState({ kind: "error", message: (e as Error).message });
    }
  }, [gmailId]);

  useEffect(() => {
    void load();
    api<{ data: ReportItem[] }>("/api/hourly-reports?page=1")
      .then((r) => setReports(r.data))
      .catch(() => setReports([]));
  }, [load]);

  const process = async () => {
    setState({ kind: "processing" });
    try {
      await processReport(gmailId);
      await waitForReport(gmailId);
      await load();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const idx = reports.findIndex((r) => r.gmailId === gmailId);
  const current = idx >= 0 ? reports[idx] : undefined;
  const previous = idx >= 0 ? reports[idx + 1] : undefined;

  const allRows = useMemo(() => (state.kind === "ready" ? state.rows : []), [state]);
  // alarm types hidden in Settings → Hourly reports are left out of the page and every export
  const rows = useMemo(() => visibleHourlyRows(allRows, hp), [allRows, hp]);
  const hiddenTypes = hourlyHiddenCount(hp);
  // option lists come from the data (within the selected sheet)
  const facets = useMemo(
    () =>
      hourlyFacets(filters.sheet ? rows.filter((r) => r.sheets.includes(filters.sheet!)) : rows),
    [rows, filters.sheet],
  );
  const sheetCounts = useMemo(() => hourlyFacets(rows).sheet, [rows]);
  const shown = useMemo(
    () => numberSites(sortHourlyRows(filterHourlyRows(rows, filters), sort)),
    [rows, filters, sort],
  );
  const sites = useMemo(() => hourlySiteCount(shown), [shown]);

  // alarm age is measured from the time the report mail arrived, as wall clock like Alarm Time
  const meta0 = state.kind === "ready" ? state.meta : null;
  const ageRef = useMemo(() => {
    const at = current?.receivedAt ?? meta0?.processedAt;
    return at ? wallClockOf(new Date(at), timeZone) : null;
  }, [current?.receivedAt, meta0?.processedAt, timeZone]);
  const fill = useCallback(
    (r: HourlyRow, k: HourlyColumnKey) => hourlyCellFill(r, k, ageRef, hp),
    [ageRef, hp],
  );

  const meta = meta0;
  const reportTitle = `Nokia hourly report${current ? ` · ${formatDateTime(current.receivedAt, timeZone)}` : ""}`;
  const fileStem = `hourly-${(current?.receivedAt ?? meta?.processedAt ?? "").slice(0, 16).replace(/[-:]/g, "").replace("T", "_")}`;

  return (
    <>
      <PageHeader
        title="Hourly report"
        count={meta ? shown.length : null}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {current && (
              <span>
                Received {formatDateTime(current.receivedAt, timeZone)} · {current.fileName}
              </span>
            )}
            {meta && (
              <span className="text-slate-400">
                processed {formatDateTime(meta.processedAt, timeZone)} in{" "}
                {(meta.durationMs / 1000).toFixed(1)} s
              </span>
            )}
          </span>
        }
        actions={
          meta && (
            <>
              {previous && (
                <Button size="sm" variant="outline" className="bg-white" asChild>
                  <Link
                    href={`/hourly/compare?a=${encodeURIComponent(previous.gmailId)}&b=${encodeURIComponent(gmailId)}`}
                  >
                    <GitCompare className="h-4 w-4" />
                    Compare with previous
                  </Link>
                </Button>
              )}
              <TableImageButton
                rows={shown}
                filters={filters}
                title={reportTitle}
                fileStem={fileStem}
                ageRef={ageRef}
              />
            </>
          )
        }
      />

      {state.kind === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading report…
        </div>
      )}
      {state.kind === "processing" && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-sky-300 bg-sky-50 py-14 text-sm text-sky-800">
          <Loader2 className="h-5 w-5 animate-spin" /> Downloading and extracting the report…
        </div>
      )}
      {state.kind === "needs-process" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-12 text-sm text-slate-600">
          This report has not been processed yet.
          {canProcess ? (
            <Button size="sm" onClick={() => void process()}>
              <Play className="h-4 w-4" /> Process now
            </Button>
          ) : (
            <span className="text-slate-500">Ask an operator to process it.</span>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 py-10 text-sm text-red-800">
          {state.message}
          <Button size="sm" variant="outline" className="bg-white" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {meta && (
        <>
          <div className="sticky top-14 z-20 -mx-1 space-y-2 rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur md:top-0">
            {/* Sheet tabs, with the column chooser and "clear" on the right. */}
            <div className="flex items-center gap-2">
              <div
                role="tablist"
                aria-label="Sheet"
                className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {[
                  { value: "", count: rows.length },
                  ...HOURLY_SHEETS.map((s) => ({
                    value: s,
                    count: sheetCounts.find((c) => c.value === s)?.count ?? 0,
                  })),
                ].map((s) => {
                  const on = (filters.sheet ?? "") === s.value;
                  return (
                    <button
                      key={s.value || "all"}
                      role="tab"
                      aria-selected={on}
                      onClick={() => setOne("sheet", s.value || null)}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm",
                        on ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {s.value ? s.value.replace("_", " ") : "All sheets"}
                      <span
                        className={cn(
                          "tabular-nums text-xs",
                          on ? "text-slate-300" : "text-slate-400",
                        )}
                      >
                        {s.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {active > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 px-2"
                  onClick={clear}
                  title="Clear filters"
                >
                  <FilterX className="h-4 w-4" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className={cn("shrink-0 bg-white", showFilters && "border-brand")}
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
                aria-controls="hourly-filters"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {active > 0 && (
                  <span className="rounded-sm bg-brand px-1.5 text-[11px] font-semibold text-white">
                    {active}
                  </span>
                )}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", showFilters && "rotate-180")}
                />
              </Button>
              <div className="shrink-0">
                <ColumnChooser
                  visible={cols.visible}
                  onChange={cols.setVisible}
                  onReset={cols.reset}
                />
              </div>
            </div>

            {/* Filters: one even grid, two rows on a laptop, one on a wide screen; the
                Filters button folds it away (kept mounted so typed text survives). */}
            <div
              id="hourly-filters"
              className={cn(
                "grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8",
                !showFilters && "hidden",
              )}
            >
              <div className="col-span-2 sm:col-span-1">
                <TextFilter
                  label="Search"
                  value={filters.q ?? ""}
                  placeholder="Code or site name"
                  onChange={(v) => setOne("q", v)}
                  inputClassName={cn(compact, "sm:w-full")}
                />
              </div>
              {pickOffice && (
                <Field label="Office">
                  <MultiSelect
                    label="Office"
                    className="w-full"
                    options={facets.office}
                    value={filters.office ?? []}
                    onChange={(v) => setMany("office", v)}
                    swatch={officeColor}
                  />
                </Field>
              )}
              <Field label="Alarm">
                <MultiSelect
                  label="Alarm"
                  className="w-full"
                  searchable
                  options={facets.alarm}
                  value={filters.alarm ?? []}
                  onChange={(v) => setMany("alarm", v)}
                />
              </Field>
              <Field label="Site type">
                <MultiSelect
                  label="Site type"
                  className="w-full"
                  options={facets.siteType}
                  value={filters.siteType ?? []}
                  onChange={(v) => setMany("siteType", v)}
                />
              </Field>
              <Field label="Category">
                <MultiSelect
                  label="Category"
                  className="w-full"
                  options={CATEGORIES.map((c) => ({ value: c }))}
                  value={filters.category ?? []}
                  onChange={(v) => setMany("category", v)}
                />
              </Field>
              <Field label="VIP">
                <select
                  aria-label="VIP"
                  className={cn(
                    compact,
                    "w-full rounded-md border border-input bg-white px-2 shadow-sm",
                  )}
                  value={filters.vip === undefined ? "" : String(filters.vip)}
                  onChange={(e) => setOne("vip", e.target.value || null)}
                >
                  <option value="">All</option>
                  <option value="true">VIP only</option>
                  <option value="false">Non-VIP</option>
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Alarm time">
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="datetime-local"
                      aria-label="Alarm time from"
                      className={cn(compact, "min-w-0 flex-1 bg-white px-2")}
                      value={filters.from ?? ""}
                      onChange={(e) => setOne("from", e.target.value || null)}
                    />
                    <span className="text-xs text-slate-400">to</span>
                    <Input
                      type="datetime-local"
                      aria-label="Alarm time to"
                      className={cn(compact, "min-w-0 flex-1 bg-white px-2")}
                      value={filters.to ?? ""}
                      onChange={(e) => setOne("to", e.target.value || null)}
                    />
                  </div>
                </Field>
              </div>
            </div>
          </div>

          {hiddenTypes > 0 && (
            <Notice icon={<EyeOff />}>
              <span>
                {allRows.length - rows.length} rows of {hiddenTypes} hidden alarm type
                {hiddenTypes === 1 ? "" : "s"} are left out of the table and every export —{" "}
                <Link
                  href="/settings/hourly"
                  className="font-medium underline-offset-2 hover:underline"
                >
                  hourly settings
                </Link>
              </span>
            </Notice>
          )}

          <HourlyTable
            rows={shown}
            columns={cols.visible}
            sort={sort}
            onSort={setSort}
            fill={fill}
          />

          <div className="flex flex-col gap-1 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span data-testid="row-count">
              Showing <b className="text-slate-800">{shown.length.toLocaleString("en-US")}</b> of{" "}
              {rows.length.toLocaleString("en-US")} rows · <b className="text-slate-800">{sites}</b>{" "}
              site
              {sites === 1 ? "" : "s"}
              {meta.emptyCodes > 0 && <> · {meta.emptyCodes} rows without a site code</>}
            </span>
            {meta.unmatchedCodes > 0 && (
              <span>
                <b className="text-amber-700">{meta.unmatchedCodes}</b> site codes are not in Site
                Master —{" "}
                <Link
                  href="/settings/site-master"
                  className="font-medium text-sky-700 underline-offset-2 hover:underline"
                >
                  import Site Master
                </Link>
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default function HourlyResultsPage({ params }: { params: { gmailId: string } }) {
  return (
    <Suspense>
      <ResultsView gmailId={decodeURIComponent(params.gmailId)} />
    </Suspense>
  );
}

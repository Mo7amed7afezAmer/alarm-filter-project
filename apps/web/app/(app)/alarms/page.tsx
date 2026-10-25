"use client";

// Active alarms: category tabs (All / Down / Power / Other, with counts), then search, a site-tag
// filter and — for a super admin viewing all offices — an office filter. Table or Mail view and
// the mail card parts are set in Settings → Display alarms.
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import { Suspense, useMemo } from "react";
import { AlarmCard, AlarmName, Mono, siteMasterColumns, SiteCell } from "@/components/alarm-bits";
import { AlarmMailList, type MailAlarm } from "@/components/alarm-mail";
import { useAppConfig } from "@/components/app-config";
import { CategoryBadge } from "@/components/badges";
import { DataTable, Pager } from "@/components/data-table";
import { Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { useUiPrefs } from "@/components/ui-prefs";
import { Button } from "@/components/ui/button";
import { usePoll, useNow } from "@/components/use-poll";
import { ageMinutes, CATEGORY_STRIPE, formatDateTime, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ActiveAlarm extends MailAlarm {
  region: string | null;
}

interface ActivePage {
  items: ActiveAlarm[];
  total: number;
  page: number;
  pages: number;
  /** Count per category with every other filter applied. */
  categories: Partial<Record<string, number>>;
  /** Super admin viewing all offices: count per office. */
  offices: { office: string; count: number }[];
}

const TABS = [
  { value: "", label: "All" },
  { value: "DOWN", label: "Down" },
  { value: "POWER", label: "Power" },
  { value: "OTHER", label: "Other" },
] as const;

const TAB_DOT: Record<string, string> = {
  DOWN: "bg-red-500",
  POWER: "bg-amber-500",
  OTHER: "bg-slate-400",
};

function CategoryTabs({
  value,
  counts,
  onChange,
}: {
  value: string;
  counts?: Partial<Record<string, number>>;
  onChange: (v: string | null) => void;
}) {
  const total = counts ? Object.values(counts).reduce((n: number, c) => n + (c ?? 0), 0) : null;
  return (
    <div
      role="tablist"
      aria-label="Category"
      className="flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {TABS.map((t) => {
        const selected = value === t.value;
        const count = t.value ? (counts?.[t.value] ?? (counts ? 0 : null)) : total;
        return (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.value || null)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium",
              selected
                ? "border-brand text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.value && <span className={cn("h-2 w-2 rounded-sm", TAB_DOT[t.value])} />}
            {t.label}
            {count !== null && (
              <span
                className={cn(
                  "rounded-sm px-1.5 text-xs tabular-nums",
                  selected ? "bg-brand text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const select = "h-9 w-full rounded-md border border-input bg-white px-2 text-sm sm:w-44";

function AgeBadge({ minutes, alert }: { minutes: number; alert: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium tabular-nums",
        alert ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700",
      )}
    >
      {formatMinutes(minutes)}
    </span>
  );
}

function AlarmsView() {
  const { timeZone, alertHours, role, office: viewOffice } = useAppConfig();
  const { params, set } = useUrlFilters();
  const now = useNow(30_000); // live age column
  const { prefs } = useUiPrefs();
  const display = prefs.alarms;
  const icons = display.siteInfoIcons;
  // Office filter only for a super admin looking at every office.
  const pickOffice = role === "SUPER_ADMIN" && viewOffice === null;
  const f = (k: string) => params.get(k) ?? "";
  const category = f("category");
  const page = Number(params.get("page") ?? 1);

  const query = new URLSearchParams();
  for (const k of ["category", "q", "flag", ...(pickOffice ? ["office"] : [])])
    if (f(k)) query.set(k, f(k));
  query.set("page", String(page));
  query.set("pageSize", "100");

  const { data, error, loading, updatedAt, reload } = usePoll<ActivePage>(
    `/api/alarms/active?${query}`,
    60_000,
  );

  const isAlert = (a: ActiveAlarm) => ageMinutes(a.alarmTime, now) > alertHours * 60;

  const columns = useMemo<ColumnDef<ActiveAlarm, unknown>[]>(
    () => [
      {
        accessorKey: "category",
        header: "Category",
        cell: (c) => <CategoryBadge value={c.getValue() as string} />,
      },
      {
        accessorKey: "alarmName",
        header: "Alarm",
        cell: (c) => (
          <AlarmName value={c.getValue() as string} className="max-w-[14rem] 2xl:max-w-[22rem]" />
        ),
      },
      {
        accessorKey: "site",
        header: "Site",
        cell: (c) => (
          <SiteCell
            site={c.getValue() as string}
            vip={c.row.original.vip}
            info={c.row.original}
            icons={icons}
          />
        ),
      },
      {
        id: "cell",
        header: "Cell / device",
        accessorFn: (r) => r.cellName ?? r.device ?? "",
        cell: (c) => <Mono className="text-slate-500">{(c.getValue() as string) || "—"}</Mono>,
      },
      {
        accessorKey: "region",
        header: "Region",
        cell: (c) => (c.getValue() as string | null) ?? <span className="text-slate-400">—</span>,
      },
      ...siteMasterColumns<ActiveAlarm>(icons),
      {
        accessorKey: "alarmTime",
        header: "Raised",
        cell: (c) => (
          <span className="text-slate-600">{formatDateTime(c.getValue() as string, timeZone)}</span>
        ),
      },
      {
        id: "age",
        header: "Age",
        accessorFn: (r) => ageMinutes(r.alarmTime, now),
        cell: (c) => (
          <AgeBadge
            minutes={c.getValue() as number}
            alert={(c.getValue() as number) > alertHours * 60}
          />
        ),
      },
    ],
    [timeZone, now, alertHours, icons],
  );

  const exportQuery = new URLSearchParams(query);
  exportQuery.delete("page");
  exportQuery.delete("pageSize");
  exportQuery.set("status", "active");

  return (
    <>
      <PageHeader
        title="Active alarms"
        count={data?.total}
        subtitle={
          <>
            Rows older than {alertHours}h are highlighted · refreshes every minute
            {updatedAt && <> · updated {formatDateTime(new Date(updatedAt), timeZone)}</>}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => void reload()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="bg-white" asChild>
              <a href={`/api/export?${exportQuery}`}>
                <Download className="h-4 w-4" />
                Export
              </a>
            </Button>
          </>
        }
      />

      <CategoryTabs
        value={category}
        counts={data?.categories}
        onChange={(v) => set({ category: v })}
      />

      <FilterBar
        active={["q", "flag", ...(pickOffice ? ["office"] : [])].filter((k) => f(k)).length}
        className="rounded-md"
      >
        <TextFilter
          label="Search"
          value={f("q")}
          placeholder="Alarm, site, site code or cell"
          onChange={(v) => set({ q: v })}
        />
        <Field label="Site">
          <select
            className={select}
            value={f("flag")}
            onChange={(e) => set({ flag: e.target.value || null })}
          >
            <option value="">All sites</option>
            <option value="vip">VIP</option>
            <option value="nodal">Nodal</option>
            <option value="generator">Generator</option>
          </select>
        </Field>
        {pickOffice && (
          <Field label="Office">
            <select
              className={select}
              value={f("office")}
              onChange={(e) => set({ office: e.target.value || null })}
            >
              <option value="">All offices</option>
              {f("office") && !data?.offices.some((o) => o.office === f("office")) && (
                <option value={f("office")}>{f("office")}</option>
              )}
              {data?.offices.map((o) => (
                <option key={o.office} value={o.office}>
                  {o.office} ({o.count})
                </option>
              ))}
            </select>
          </Field>
        )}
      </FilterBar>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load: {error}
        </p>
      )}
      {display.view === "mail" ? (
        <AlarmMailList
          items={data?.items ?? []}
          now={now}
          timeZone={timeZone}
          loading={loading && !data}
          empty="No active alarms — all clear"
          alert={isAlert}
          age={(r) => <AgeBadge minutes={ageMinutes(r.alarmTime, now)} alert={isAlert(r)} />}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          getRowId={(r) => String(r.id)}
          loading={loading && !data}
          empty="No active alarms — all clear"
          hiddenColumns={display.hiddenColumns.active}
          groupBy={display.groupBySite ? (r) => r.siteCode ?? r.site : undefined}
          groupNoun="alarms"
          rowClassName={(r) =>
            cn(CATEGORY_STRIPE[r.category], isAlert(r) && "bg-red-50/70 hover:bg-red-50")
          }
          renderCard={(r) => (
            <AlarmCard
              alarmName={r.alarmName}
              category={r.category}
              site={r.site}
              cell={r.cellName ?? r.device}
              info={r}
              icons={icons}
              alert={isAlert(r)}
              meta={formatDateTime(r.alarmTime, timeZone)}
              right={<AgeBadge minutes={ageMinutes(r.alarmTime, now)} alert={isAlert(r)} />}
            />
          )}
        />
      )}
      {data && (
        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          onPage={(p) => set({ page: String(p) })}
        />
      )}
    </>
  );
}

export default function AlarmsPage() {
  return (
    <Suspense>
      <AlarmsView />
    </Suspense>
  );
}

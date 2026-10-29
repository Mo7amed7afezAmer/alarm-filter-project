"use client";

import {
  HOURLY_COLUMNS,
  HOURLY_DEFAULT_COLUMNS,
  hourlyCellText,
  officeColor,
  type HourlyColumnKey,
  type HourlyRow,
  type HourlySort,
} from "@alarm/core";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Columns3,
  Inbox,
  RotateCcw,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneLink } from "@/components/alarm-bits";
import { useHourlyPrefs } from "@/components/hourly-prefs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ALL_KEYS = HOURLY_COLUMNS.map((c) => c.key) as HourlyColumnKey[];

/**
 * Visible table columns in the office's order (hourly_settings tableColumns, also edited in
 * Settings → Alarms, images & colours — admins only). A column switched on here is added at the end.
 */
export function useColumnPrefs() {
  const { hp, update } = useHourlyPrefs();
  const visible = hp.tableColumns;
  const save = (keys: HourlyColumnKey[]) => update((p) => ({ ...p, tableColumns: keys }));
  return { visible, setVisible: save, reset: () => save(HOURLY_DEFAULT_COLUMNS) };
}

export function ColumnChooser({
  visible,
  onChange,
  onReset,
}: {
  visible: HourlyColumnKey[];
  onChange: (keys: HourlyColumnKey[]) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" className="bg-white" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="h-4 w-4" />
        Columns
        <span className="tabular-nums text-slate-400">
          {visible.length}/{ALL_KEYS.length}
        </span>
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {HOURLY_COLUMNS.map((c) => {
            const on = visible.includes(c.key);
            return (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-100/70"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && visible.length === 1}
                  onChange={() =>
                    onChange(on ? visible.filter((k) => k !== c.key) : [...visible, c.key])
                  }
                />
                {c.header}
              </label>
            );
          })}
          <button
            className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100/70"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
          <Link
            href="/settings/hourly"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-sky-700 hover:bg-slate-100/70"
          >
            <Settings2 className="h-3.5 w-3.5" /> Column order and more…
          </Link>
        </div>
      )}
    </div>
  );
}

function Cell({ row, k }: { row: HourlyRow; k: HourlyColumnKey }) {
  switch (k) {
    case "alarmTime":
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums text-slate-700">
          {row.clockInvalid && (
            <span
              role="img"
              aria-label="Invalid clock"
              title="NE clock not set (year before 2020) — time is not reliable"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            </span>
          )}
          {row.alarmTime}
        </span>
      );
    case "code":
      return (
        <span className="font-mono text-xs font-medium text-slate-900">{row.code || "—"}</span>
      );
    case "vip":
      return row.vip ? (
        <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          VIP
        </span>
      ) : (
        <span className="text-slate-400">{row.vip === null ? "" : "—"}</span>
      );
    case "phone":
      return <PhoneLink value={row.phone || null} />;
    case "technologies":
      return (
        <span className="flex gap-1">
          {row.technologies.map((t) => (
            <span
              key={t}
              className="rounded border border-slate-300 bg-white/70 px-1 text-[10px] font-semibold"
            >
              {t}
            </span>
          ))}
        </span>
      );
    case "office":
      return row.office ? (
        <span className="font-medium text-slate-900">{row.office}</span>
      ) : (
        <span className="text-xs italic text-slate-400">unknown code</span>
      );
    default: {
      const t = hourlyCellText(row, k);
      return (
        <span className="block max-w-[22rem] truncate" title={t}>
          {t}
        </span>
      );
    }
  }
}

const ROW_HEIGHT = 34;

/**
 * Virtualized hourly table (thousands of rows): sticky header, office row colors, controlled
 * sort (click = sort by column, shift+click = add secondary sort). Rows arrive filtered and
 * sorted — this component only renders.
 */
export function HourlyTable({
  rows,
  columns,
  sort,
  onSort,
  height = "calc(100vh - 20rem)",
  empty = "No rows match the filters",
  loading,
  fill,
}: {
  rows: HourlyRow[];
  columns: HourlyColumnKey[];
  /** Cell background ("RRGGBB") — age colors from the hourly settings; default office color. */
  fill?: (row: HourlyRow, key: HourlyColumnKey) => string | null;
  sort: HourlySort;
  onSort?: (s: HourlySort) => void;
  height?: string;
  empty?: string;
  loading?: boolean;
}) {
  const defs = useMemo<ColumnDef<HourlyRow>[]>(
    () =>
      HOURLY_COLUMNS.map((c) => ({
        id: c.key,
        header: c.header,
        cell: (ctx) => <Cell row={ctx.row.original} k={c.key} />,
      })),
    [],
  );
  const visibility = useMemo<VisibilityState>(
    () => Object.fromEntries(HOURLY_COLUMNS.map((c) => [c.key, columns.includes(c.key)])),
    [columns],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { columnVisibility: visibility, columnOrder: columns },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
    manualSorting: true,
  });
  const tableRows = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1]!.end : 0;

  const clickHeader = (key: HourlyColumnKey, shift: boolean) => {
    if (!onSort) return;
    const i = sort.findIndex((s) => s.key === key);
    if (shift) {
      onSort(
        i >= 0
          ? sort.map((s) => (s.key === key ? { ...s, desc: !s.desc } : s))
          : [...sort, { key, desc: false }],
      );
    } else {
      onSort([{ key, desc: i === 0 ? !sort[0]!.desc : false }]);
    }
  };

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-sm text-slate-500">
        {loading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        ) : (
          <Inbox className="h-6 w-6 text-slate-400" />
        )}
        {loading ? "Loading…" : empty}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm"
      style={{ maxHeight: height, minHeight: "16rem" }}
      data-testid="hourly-table"
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const key = h.column.id as HourlyColumnKey;
                const idx = sort.findIndex((s) => s.key === key);
                const s = idx >= 0 ? sort[idx] : undefined;
                return (
                  <th
                    key={h.id}
                    onClick={(e) => clickHeader(key, e.shiftKey)}
                    title={
                      onSort ? "Click to sort · Shift+click to add a secondary sort" : undefined
                    }
                    className={cn(
                      "h-10 whitespace-nowrap border-b border-slate-200 px-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500",
                      onSort && "cursor-pointer select-none hover:text-slate-900",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {s &&
                        (s.desc ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        ))}
                      {s && sort.length > 1 && <sup className="text-[9px]">{idx + 1}</sup>}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr>
              <td style={{ height: padTop }} colSpan={columns.length} />
            </tr>
          )}
          {items.map((vi) => {
            const row = tableRows[vi.index]!;
            const color = officeColor(row.original.office);
            const office = color ? `#${color}40` : undefined;
            return (
              <tr
                key={row.id}
                data-office={row.original.office || undefined}
                style={{ height: ROW_HEIGHT, background: office }}
                className="hover:brightness-95"
              >
                {row.getVisibleCells().map((cell) => {
                  // only colors that differ from the office color are painted per cell
                  const c = fill?.(row.original, cell.column.id as HourlyColumnKey);
                  const own = c && c !== color ? `#${c}` : undefined;
                  return (
                    <td
                      key={cell.id}
                      style={own ? { background: own, color: "#0f172a" } : undefined}
                      className="whitespace-nowrap border-b border-black/5 px-3 py-1.5"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr>
              <td style={{ height: padBottom }} colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export type CellFill = (row: HourlyRow, key: HourlyColumnKey) => string | null;

/** Column definitions in the given order (unknown keys dropped). */
export const orderedColumns = (keys: readonly HourlyColumnKey[]) =>
  keys
    .map((k) => HOURLY_COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof HOURLY_COLUMNS)[number] => !!c);

/** Rows as TSV + an HTML table with office colors (pastes into Excel / Outlook with colors). */
export function tableClipboard(rows: HourlyRow[], columns: HourlyColumnKey[], fill?: CellFill) {
  const cols = orderedColumns(columns);
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const tsv = [
    cols.map((c) => c.header),
    ...rows.map((r) => cols.map((c) => clean(hourlyCellText(r, c.key)))),
  ]
    .map((line) => line.join("\t"))
    .join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    `<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-family:Calibri,Arial;font-size:11pt">` +
    `<tr>${cols.map((c) => `<th style="background:#E2E8F0">${esc(c.header)}</th>`).join("")}</tr>` +
    rows
      .map((r) => {
        const cells = cols.map((c) => {
          const color = fill ? fill(r, c.key) : officeColor(r.office);
          return `<td${color ? ` style="background:#${color}"` : ""}>${esc(hourlyCellText(r, c.key))}</td>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("") +
    `</table>`;
  return { tsv, html };
}

/**
 * Copies rich (HTML) + plain text. navigator.clipboard needs a secure context (HTTPS or
 * localhost) — on http://<lan-ip> fall back to execCommand on a temporary selection.
 */
export async function copyRows(
  rows: HourlyRow[],
  columns: HourlyColumnKey[],
  fill?: CellFill,
): Promise<void> {
  const { tsv, html } = tableClipboard(rows, columns, fill);
  if (window.isSecureContext && navigator.clipboard && "ClipboardItem" in window) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([tsv], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  const div = document.createElement("div");
  div.contentEditable = "true";
  div.style.position = "fixed";
  div.style.left = "-99999px";
  div.innerHTML = html;
  document.body.appendChild(div);
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  const ok = document.execCommand("copy");
  sel?.removeAllRanges();
  div.remove();
  if (!ok) throw new Error("The browser blocked copying");
}

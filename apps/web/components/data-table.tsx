"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Inbox,
} from "lucide-react";
import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  rowClassName?: (row: T) => string | undefined;
  /** Phone layout: one card per row (shown below the md breakpoint instead of the table). */
  renderCard?: (row: T) => ReactNode;
  getRowId?: (row: T) => string;
  empty?: string;
  loading?: boolean;
  /** Column ids not shown (the user's column chooser). */
  hiddenColumns?: string[];
  /** Rows with the same key are shown once; clicking that row expands the others. */
  groupBy?: (row: T) => string;
  /** What the group's rows are called in the hints, e.g. "alarms". */
  groupNoun?: string;
}

interface Group<T> {
  key: string;
  rows: Row<T>[];
}

/** Rows with the same key, in the order of each key's first (sorted) row. */
function groupRows<T>(rows: Row<T>[], key?: (row: T) => string): Group<T>[] {
  if (!key) return rows.map((r) => ({ key: r.id, rows: [r] }));
  const map = new Map<string, Row<T>[]>();
  for (const r of rows) {
    const k = key(r.original);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map].map(([k, rs]) => ({ key: k, rows: rs }));
}

/** A click on a link / button inside the row must not also toggle the group. */
const fromControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest("a,button,input,select");

/**
 * Sortable table (client-side sort of the current page) with a card list on phones; optional
 * column hiding and grouping of rows by a key (e.g. site code).
 */
export function DataTable<T>({
  columns,
  data,
  rowClassName,
  renderCard,
  getRowId,
  empty = "No rows",
  loading,
  hiddenColumns,
  groupBy,
  groupNoun = "rows",
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const columnVisibility = useMemo(
    () => Object.fromEntries((hiddenColumns ?? []).map((id) => [id, false])),
    [hiddenColumns],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });
  const rows = table.getRowModel().rows;
  const groups = groupRows(rows, groupBy);
  const grouped = !!groupBy;
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

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
    <>
      {renderCard && (
        <div className="space-y-2 md:hidden">
          {groups.map(({ key, rows: [first, ...rest] }) => {
            const expanded = open.has(key);
            return (
              <div key={first.id} className="space-y-2">
                {renderCard(first.original)}
                {rest.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-sky-700 hover:bg-slate-100"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {expanded ? "Hide" : "Show"} {rest.length} more {groupNoun} at this site
                  </button>
                )}
                {expanded && (
                  <div className="space-y-2 border-l-2 border-slate-300 pl-3">
                    {rest.map((r) => (
                      <div key={r.id}>{renderCard(r.original)}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className={cn(
          "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm",
          renderCard && "hidden md:block",
        )}
      >
        <Table>
          <TableHeader className="bg-slate-50/80">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {grouped && <TableHead className="w-8 px-2" aria-label="Group" />}
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const sortable = h.column.getCanSort();
                  return (
                    <TableHead
                      key={h.id}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-xs font-medium uppercase tracking-wide text-slate-500",
                        sortable && "cursor-pointer select-none hover:text-slate-900",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                        {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {groups.map(({ key, rows: members }) => {
              const expanded = open.has(key);
              const many = members.length > 1;
              const shown = expanded ? members : members.slice(0, 1);
              return (
                <Fragment key={members[0].id}>
                  {shown.map((row, i) => (
                    <TableRow
                      key={row.id}
                      onClick={many && i === 0 ? (e) => !fromControl(e) && toggle(key) : undefined}
                      className={cn(
                        "border-l-4 border-l-transparent",
                        rowClassName?.(row.original),
                        many && i === 0 && "cursor-pointer",
                        i > 0 && "bg-slate-100/60",
                      )}
                    >
                      {grouped && (
                        <TableCell className="w-8 px-2 py-2.5">
                          {many && i === 0 ? (
                            <button
                              type="button"
                              onClick={() => toggle(key)}
                              aria-expanded={expanded}
                              title={`${members.length} ${groupNoun} at this site — click to ${expanded ? "hide" : "show"} them`}
                              className="flex items-center gap-0.5 rounded-full bg-sky-100 py-0.5 pl-1 pr-1.5 text-[11px] font-semibold tabular-nums text-sky-800 hover:bg-sky-200"
                            >
                              {expanded ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              {members.length}
                            </button>
                          ) : (
                            i > 0 && (
                              <CornerDownRight className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
                            )
                          )}
                        </TableCell>
                      )}
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="whitespace-nowrap px-3 py-2.5">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-2 text-sm text-slate-500 sm:flex-row">
      <span>{total.toLocaleString("en-US")} rows</span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-100/70 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <span className="px-2 tabular-nums">
            {page} / {pages}
          </span>
          <button
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-100/70 disabled:opacity-40"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

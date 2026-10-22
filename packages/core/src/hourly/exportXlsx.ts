// Excel export reproducing the visible table (§14): chosen columns in order, bold header,
// cells filled by office (or alarm-age) color, frozen header, autofilter, column widths.
// One worksheet per output group when the user splits by category / office. Server-only.

import ExcelJS from "exceljs";
import type { HourlyGroup } from "./output.js";
import {
  HOURLY_COLUMNS,
  HOURLY_DEFAULT_COLUMNS,
  hourlyCellText,
  officeColor,
  type HourlyColumnKey,
  type HourlyRow,
} from "./types.js";

export interface HourlyXlsxOptions {
  /** Sheet name when `input` is a plain row list. */
  sheetName?: string;
  /** Cell fill ("RRGGBB" or null); default = office color of the row. */
  fill?: (row: HourlyRow, key: HourlyColumnKey) => string | null;
}

/** Excel sheet name: no []:*?/\, ≤ 31 chars, unique in the workbook. */
function sheetTitle(label: string, used: Set<string>): string {
  const base = (label.replace(/[[\]:*?/\\]/g, "-").trim() || "Hourly alarms").slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toUpperCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name.toUpperCase());
  return name;
}

export async function buildHourlyXlsx(
  input: readonly HourlyRow[] | readonly HourlyGroup[],
  columns: readonly HourlyColumnKey[] = HOURLY_DEFAULT_COLUMNS,
  options: HourlyXlsxOptions | string = {},
): Promise<Buffer> {
  const opts = typeof options === "string" ? { sheetName: options } : options;
  const cols = columns
    .map((k) => HOURLY_COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof HOURLY_COLUMNS)[number] => !!c);
  if (!cols.length) throw new Error("No valid columns to export");
  const fill = opts.fill ?? ((r: HourlyRow) => officeColor(r.office));
  const groups: readonly { label: string; rows: readonly HourlyRow[] }[] =
    input.length && "rows" in input[0]!
      ? (input as readonly HourlyGroup[])
      : [{ label: opts.sheetName ?? "Hourly alarms", rows: input as readonly HourlyRow[] }];

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const used = new Set<string>();
  for (const g of groups) {
    const ws = wb.addWorksheet(sheetTitle(g.label, used));
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));

    for (const r of g.rows) {
      const row = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, hourlyCellText(r, c.key)])));
      cols.forEach((c, i) => {
        const color = fill(r, c.key);
        if (color)
          row.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
      });
    }

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + g.rows.length, column: cols.length } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

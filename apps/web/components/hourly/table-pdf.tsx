"use client";

// PDF of the filtered hourly table, built in the browser (jsPDF + autotable, loaded on click).
// Same settings as the Excel export: table columns in the user's order, one section per
// category / office group starting on a new page, cells filled by office or alarm-age color.

import {
  hourlyCellFill,
  hourlyCellText,
  hourlySiteCount,
  splitHourlyRows,
  type HourlyFilters,
  type HourlyRow,
} from "@alarm/core";
import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { orderedColumns } from "@/components/hourly/hourly-table";
import { filterSummary } from "@/components/hourly/table-image";
import { Button } from "@/components/ui/button";
import { useHourlyPrefs } from "@/components/hourly-prefs";

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16),
];

export function TablePdfButton({
  rows,
  title,
  filters,
  fileStem,
  ageRef,
}: {
  /** Filtered + sorted rows. */
  rows: HourlyRow[];
  title: string;
  filters: HourlyFilters;
  fileStem: string;
  /** Report time (wall clock) the alarm age is measured from. */
  ageRef: string | null;
}) {
  const { hp: hourly } = useHourlyPrefs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const hp = hourly;
      const cols = orderedColumns(hp.tableColumns);
      const groups = splitHourlyRows(rows, hp.split);
      const subtitle = filterSummary(filters);
      const stamp = new Date().toLocaleString("en-GB", { hour12: false });
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
      const margin = 28;

      groups.forEach((g, gi) => {
        if (gi > 0) doc.addPage();
        const sites = hourlySiteCount(g.rows);
        doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(15, 23, 42);
        doc.text(g.label ? `${title} · ${g.label}` : title, margin, margin + 4);
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(71, 85, 105);
        const info = `${g.rows.length.toLocaleString("en-US")} rows · ${sites} site${sites === 1 ? "" : "s"}`;
        doc.text(subtitle ? `${info} · ${subtitle}` : info, margin, margin + 18, {
          maxWidth: doc.internal.pageSize.getWidth() - 2 * margin,
        });
        autoTable(doc, {
          startY: margin + 28,
          margin: { left: margin, right: margin, bottom: margin },
          head: [cols.map((c) => c.header)],
          body: g.rows.map((r) => cols.map((c) => hourlyCellText(r, c.key))),
          theme: "grid",
          styles: { fontSize: 7, cellPadding: 2.5, textColor: [15, 23, 42], lineColor: [148, 163, 184], lineWidth: 0.4 },
          headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: "bold" },
          didParseCell: (d) => {
            if (d.section !== "body") return;
            const color = hourlyCellFill(g.rows[d.row.index]!, cols[d.column.index]!.key, ageRef, hp);
            d.cell.styles.fillColor = color ? rgb(color) : [255, 255, 255];
          },
        });
      });

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100, 116, 139);
        doc.text(`Alarm Filter · ${stamp} · page ${i}/${pages}`, margin, doc.internal.pageSize.getHeight() - 12);
      }
      doc.save(`${fileStem}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="bg-white"
      onClick={() => void build()}
      disabled={busy || !rows.length}
      title={error ?? "Download the table as PDF (groups and colors from Settings → Hourly reports)"}
      data-testid="export-pdf"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {error ? "PDF failed" : "PDF"}
    </Button>
  );
}

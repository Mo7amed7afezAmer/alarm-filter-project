"use client";

// "Table as image" for sharing on WhatsApp: the filtered rows are drawn on a <canvas> (office
// colors, header, title) and split into pages so each picture stays readable on a phone.
// Columns, image sets (Down, Down sites, Environmental, …), rows per image and colours come from
// the user's hourly settings (Settings → Hourly reports); the dialog can change the sets and the
// rows per image for one export. The gear opens Image settings: Images (the sets of this export)
// and Share settings (per user, uiPrefs.hourlyShare): every image to one chat, or each office's
// images — drawn from that office's rows only — to its own chat.
// Drawing and the Share / Download window are shared with the alarms page (image-export.tsx).

import {
  HOURLY_IMAGE_SETS,
  HOURLY_ROWS_PER_IMAGE,
  hourlyCellFill,
  hourlyCellText,
  hourlyImageGroups,
  hourlySiteCount,
  type HourlyFilters,
  type HourlyShare,
  type HourlyPrefs,
  type HourlyRow,
} from "@alarm/core";
import { ImageIcon, Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { orderedColumns, type CellFill } from "@/components/hourly/hourly-table";
import {
  columnWidths,
  drawTable,
  ImageExportDialog,
  slug,
  type ImagePage,
  type ImageRow,
  type ShareTarget,
} from "@/components/image-export";
import { ChatInput } from "@/components/alarm-image";
import { Button } from "@/components/ui/button";
import { useHourlyPrefs } from "@/components/hourly-prefs";
import { useUiPrefs } from "@/components/ui-prefs";
import { useWhatsAppSender } from "@/components/whatsapp";

/** Short names of the image sets (dialog + settings). */
export const IMAGE_SET_NAME: Record<keyof HourlyPrefs["images"], string> = {
  down: "Down",
  downSites: "Down sites",
  env: "Environmental",
  envVipNodal: "Env · VIP / Nodal",
  power: "Power",
};

/** "Office: TANTA, DUMIAT · Sheet: Environmental" — empty when nothing is filtered. */
export function filterSummary(f: HourlyFilters): string {
  const parts: string[] = [];
  if (f.sheet) parts.push(f.sheet.replace("_", " "));
  const list = (label: string, v?: string[]) =>
    v?.length && parts.push(`${label}: ${v.join(", ")}`);
  list("Office", f.office);
  list("Alarm", f.alarm);
  list("Region", f.region);
  list("Site type", f.siteType);
  list("Category", f.category);
  if (f.vip !== undefined) parts.push(f.vip ? "VIP only" : "Non-VIP");
  if (f.from || f.to)
    parts.push(`Time: ${f.from?.replace("T", " ") ?? "…"} → ${f.to?.replace("T", " ") ?? "…"}`);
  if (f.q) parts.push(`Search: ${f.q}`);
  return parts.join(" · ");
}

type SettingsTab = "images" | "share";

/** Gear window of the hourly image: the image sets of this export and the share chats. */
function HourlyImageSettings({
  sets,
  onSets,
  share,
  onShare,
  offices,
  onClose,
}: {
  sets: HourlyPrefs["images"];
  onSets: (s: HourlyPrefs["images"]) => void;
  share: HourlyShare;
  onShare: (s: HourlyShare) => void;
  /** Offices of the rows (Site Master names). */
  offices: string[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("images");
  // Share settings only while the user's own WhatsApp number is linked
  const { ready: linked } = useWhatsAppSender();
  // offices with a saved chat that are not in this report stay listed
  const names = [...new Set([...offices, ...Object.keys(share.offices)])].sort();
  const setOfficeChat = (o: string, v: string) => {
    const next = { ...share.offices };
    if (v) next[o] = v;
    else delete next[o];
    onShare({ ...share, offices: next });
  };
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-2 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Image settings"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h3 className="font-semibold text-slate-900">Image settings</h3>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 px-4 pt-2" role="tablist">
          {(
            [
              ["images", "Images"],
              ["share", "Share settings"],
            ] as const
          )
            .filter(([id]) => id !== "share" || linked)
            .map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={
                  "border-b-2 px-3 pb-2.5 text-sm font-medium " +
                  (tab === id
                    ? "border-brand text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-900")
                }
              >
                {label}
              </button>
            ))}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {tab === "images" || !linked ? (
            <>
              <p className="text-xs text-slate-500">
                The image sets of this export. The defaults (and per office / office groups) are in
                Settings → Alarms, images &amp; colours.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {HOURLY_IMAGE_SETS.map((k) => (
                  <label
                    key={k}
                    className="flex h-9 items-center gap-2 rounded-md bg-slate-100 px-3 text-slate-900"
                  >
                    <input
                      type="checkbox"
                      checked={sets[k].enabled}
                      onChange={(e) =>
                        onSets({ ...sets, [k]: { ...sets[k], enabled: e.target.checked } })
                      }
                    />
                    {IMAGE_SET_NAME[k]}
                    {(sets[k].byOffice || sets[k].grouped) && (
                      <span className="text-xs text-slate-500">
                        ({sets[k].grouped ? "office groups" : "per office"})
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {(
                  [
                    ["all", "All images to one chat"],
                    ["office", "Each office to its own chat"],
                  ] as const
                ).map(([mode, text]) => (
                  <label key={mode} className="flex h-8 items-center gap-2 text-slate-900">
                    <input
                      type="radio"
                      name="hourly-share-mode"
                      checked={share.mode === mode}
                      onChange={() => onShare({ ...share, mode })}
                    />
                    {text}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {share.mode === "all"
                  ? "Every image goes to this chat."
                  : "Each office's chat gets images of that office's rows only."}{" "}
                A WhatsApp number or a group invite link (group info → Invite via link). Empty = you
                pick the chat.
              </p>
              {share.mode === "all" ? (
                <div className="max-w-md">
                  <ChatInput
                    value={share.all}
                    label="All images: number or group link"
                    onChange={(all) => onShare({ ...share, all })}
                  />
                </div>
              ) : names.length === 0 ? (
                <p className="text-slate-500">No offices in this report.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {names.map((o) => (
                    <div
                      key={o}
                      className="flex items-start gap-2 rounded-md bg-slate-100 px-2 py-1.5"
                    >
                      <span className="w-32 shrink-0 truncate pt-1.5 text-slate-900" title={o}>
                        {o}
                      </span>
                      <ChatInput
                        value={share.offices[o] ?? ""}
                        label={`${o}: number or group link`}
                        onChange={(v) => setOfficeChat(o, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <Button size="sm" className="h-9" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TableImageButton({
  rows,
  title,
  filters,
  fileStem,
  ageRef,
}: {
  /** Filtered + sorted rows (site numbers are added per image group). */
  rows: HourlyRow[];
  title: string;
  filters: HourlyFilters;
  /** File name prefix, e.g. "hourly-2026-10-13_0700". */
  fileStem: string;
  /** Report time as wall clock "YYYY-MM-DD HH:mm:ss" — alarm age is measured from it. */
  ageRef: string | null;
}) {
  const { hp } = useHourlyPrefs();
  const [open, setOpen] = useState(false);
  const [perPage, setPerPage] = useState(hp.imageRowsPerPage);
  const [sets, setSets] = useState<HourlyPrefs["images"]>(hp.images);
  const [pages, setPages] = useState<ImagePage[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Images of each office's own rows (for the office chats). */
  const [officePages, setOfficePages] = useState<Record<string, ImagePage[]>>({});
  const { prefs, update } = useUiPrefs();
  const share = prefs.hourlyShare;
  const setShare = (hourlyShare: HourlyShare) => update((p) => ({ ...p, hourlyShare }));
  const offices = useMemo(
    () => [...new Set(rows.map((r) => r.office.trim().toUpperCase()).filter(Boolean))].sort(),
    [rows],
  );
  // offices whose chat is saved and that have rows: their images are drawn separately
  const shareOffices =
    share.mode === "office" ? offices.filter((o) => share.offices[o]) : ([] as string[]);
  const shareKey = shareOffices.join("|");

  // the settings are the starting point every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setPerPage(hp.imageRowsPerPage);
    setSets(hp.images);
  }, [open, hp.imageRowsPerPage, hp.images]);

  const cols = useMemo(() => orderedColumns(hp.tableColumns), [hp.tableColumns]);
  const subtitle = filterSummary(filters);
  const fill = useCallback<CellFill>((r, k) => hourlyCellFill(r, k, ageRef, hp), [ageRef, hp]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const made: ImagePage[] = [];
    setBusy(true);
    setMsg(null);
    (async () => {
      const groups = hourlyImageGroups(rows, sets, perPage);
      const cells = (r: HourlyRow): ImageRow => ({
        text: cols.map((c) => hourlyCellText(r, c.key)),
        fill: cols.map((c) => fill(r, c.key)),
      });
      const headers = cols.map((c) => c.header);
      // same column widths for every image so they line up when scrolled through
      const widths = columnWidths(
        headers,
        groups.flatMap((g) => g.rows.map(cells)),
      );
      const stamp = new Date().toLocaleString("en-GB", { hour12: false });
      /** Draws the groups' pages (into `made` too, so they are freed on close). */
      const draw = async (gs: typeof groups, prefix = "") => {
        const out: ImagePage[] = [];
        for (const g of gs) {
          const n = Math.max(1, Math.ceil(g.rows.length / perPage));
          const label = [prefix, g.label].filter(Boolean).join(" · ");
          const head = label ? `${title} · ${label}` : title;
          const sites = hourlySiteCount(g.rows);
          for (let i = 0; i < n && !cancelled; i++) {
            const slice = g.rows.slice(i * perPage, (i + 1) * perPage);
            const range = g.rows.length
              ? `${label ? `${label} ` : ""}rows ${i * perPage + 1}–${i * perPage + slice.length} of ${g.rows.length} · ${sites} site${sites === 1 ? "" : "s"}`
              : "no rows";
            const blob = await drawTable({
              rows: slice.map(cells),
              headers,
              widths,
              title: n > 1 ? `${head}  (${i + 1}/${n})` : head,
              subtitle,
              footer: `${range} · Alarm Filter · ${stamp}`,
            });
            const s = slug(label);
            const name = `${fileStem}${s ? `-${s}` : ""}${n > 1 ? `-${i + 1}of${n}` : ""}.png`;
            const file = new File([blob], name, { type: "image/png" });
            const page = { file, url: URL.createObjectURL(blob) };
            made.push(page);
            out.push(page);
          }
        }
        return out;
      };
      const shown = await draw(groups);
      // each office chat: the same image sets, made from that office's rows only
      const perOffice: Record<string, ImagePage[]> = {};
      for (const o of shareOffices) {
        if (cancelled) break;
        const own = rows.filter((r) => r.office.trim().toUpperCase() === o);
        const single = Object.fromEntries(
          Object.entries(sets).map(([k, v]) => [k, { ...v, byOffice: false, grouped: false }]),
        ) as HourlyPrefs["images"];
        perOffice[o] = await draw(hourlyImageGroups(own, single, perPage), o);
      }
      if (!cancelled) {
        setPages(shown);
        setOfficePages(perOffice);
      }
    })()
      .catch((e) => !cancelled && setMsg((e as Error).message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      made.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // shareOffices is keyed by shareKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, cols, perPage, sets, title, subtitle, fileStem, fill, shareKey]);

  const targets: ShareTarget[] =
    share.mode === "office"
      ? shareOffices
          .filter((o) => officePages[o]?.length)
          .map((o) => ({ label: o, chat: share.offices[o]!, pages: officePages[o]! }))
      : share.all
        ? [{ label: "All images", chat: share.all, pages }]
        : [];

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="table-image">
        <ImageIcon className="h-4 w-4" />
        Export image
      </Button>
      {open && (
        <ImageExportDialog
          title="Table as image"
          pages={pages}
          busy={busy}
          msg={msg}
          onMsg={setMsg}
          onClose={() => setOpen(false)}
          targets={targets}
          toolbar={
            <button
              type="button"
              aria-label="Image settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
              title="Images and share settings"
              className={
                "rounded-md p-1.5 hover:bg-slate-100 hover:text-slate-900 " +
                (settingsOpen ? "bg-slate-100 text-brand" : "text-slate-500")
              }
            >
              <Settings className="h-5 w-5" />
            </button>
          }
          summary={
            <>
              {rows.length.toLocaleString("en-US")} rows → {pages.length} image
              {pages.length === 1 ? "" : "s"}
            </>
          }
          controls={
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Rows per image</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                >
                  {HOURLY_ROWS_PER_IMAGE.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {settingsOpen && (
                <HourlyImageSettings
                  sets={sets}
                  onSets={setSets}
                  share={share}
                  onShare={setShare}
                  offices={offices}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </>
          }
        />
      )}
    </>
  );
}

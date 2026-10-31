"use client";

// "Export image" of the active alarms page: every active alarm matching the page's filters,
// one row per site (siteImageRows), Down / Power / Other marked with ✓ (and the count when
// several) on the category colours. All offices in one table, or one table per office.
// Sites whose alarms are all in a hidden category column are left out (visibleSiteRows).
// Columns, sort, the office split and rows per image are the user's (uiPrefs.alarms.image) and are
// saved as they are changed in the window; the gear opens the rest: a colour per office (fill of
// the Office cell) and the share chats — a number or group link per office (gets that office's
// images) and one for all images; Send walks through them one click per chat.

import {
  ALARM_IMAGE_COLUMNS,
  ALARM_IMAGE_ROWS,
  ALARM_IMAGE_SORTS,
  categoryMark,
  markCategory,
  siteImageGroups,
  siteImageRows,
  shownAlarmCount,
  shownCategories,
  ALARM_IMAGE_CATEGORIES,
  choiceCategories,
  imageCategoryOf,
  sitesWithCategories,
  type AlarmImageCategory,
  withShownTime,
  sortSiteRows,
  visibleSiteRows,
  normalizeWhatsAppTarget,
  whatsappTarget,
  type AlarmImageSort,
  type AlarmImageColumn,
  type Category,
  type SiteImageRow,
} from "@alarm/core";
import { ImageIcon, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MailAlarm } from "@/components/alarm-mail";
import { useAppConfig } from "@/components/app-config";
import {
  columnWidths,
  drawTable,
  ImageExportDialog,
  slug,
  type ImagePage,
  type ImageRow,
  type ShareTarget,
} from "@/components/image-export";
import { useUiPrefs } from "@/components/ui-prefs";
import { useWhatsAppSender } from "@/components/whatsapp";
import { Button } from "@/components/ui/button";
import { ageMinutes, formatDateTime, formatMinutes } from "@/lib/format";

/** Category colours of the app (red / amber / slate), light enough for dark text. */
const CATEGORY_FILL: Record<Category, string> = {
  DOWN: "fca5a5",
  POWER: "fcd34d",
  OTHER: "cbd5e1",
};
const ALERT_FILL = "fee2e2";

/** "DN/Kafr ElDawar" → "Kafr ElDawar" (the name the Office column shows). */
const officeName = (office: string | null) => office?.split("/").pop() ?? "";

/** A WhatsApp number or group link field; saved (normalized) on blur / Enter. */
export function ChatInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const target = whatsappTarget(draft);
  const commit = () => onChange(normalizeWhatsAppTarget(draft));
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        type="text"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder="Number or group link"
        className="h-8 w-full rounded-md border border-input bg-white px-2 text-sm"
      />
      {draft.trim() && (
        <span className={"text-xs " + (target ? "text-slate-500" : "text-red-700")}>
          {!target
            ? "Not a number or group link — ignored"
            : target.kind === "phone"
              ? `Chat with +${target.phone}`
              : "WhatsApp group"}
        </span>
      )}
    </span>
  );
}

type SettingsTab = "columns" | "colours" | "share";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "columns", label: "Columns" },
  { id: "colours", label: "Office colours" },
  { id: "share", label: "Share settings" },
];

/** Gear window: tabs Columns · Office colours (Office cell fill) · Share settings (chats). */
function ImageSettings({
  offices,
  columns,
  colors,
  shareAll,
  shareOffices,
  shareMode,
  onColumns,
  onColors,
  onShareAll,
  onShareOffices,
  onShareMode,
  onClose,
}: {
  /** Offices of the alarms in the image. */
  offices: string[];
  columns: AlarmImageColumn[];
  colors: Record<string, string>;
  shareAll: string;
  shareOffices: Record<string, string>;
  shareMode: "all" | "office";
  onColumns: (c: AlarmImageColumn[]) => void;
  onColors: (c: Record<string, string>) => void;
  onShareMode: (m: "all" | "office") => void;
  onShareAll: (v: string) => void;
  onShareOffices: (v: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("columns");
  // Share settings only while the user's own WhatsApp number is linked
  const { ready: linked } = useWhatsAppSender();
  const tabs = SETTINGS_TABS.filter((t) => t.id !== "share" || linked);
  // offices with saved settings that are not in this image are kept, listed after the others
  const names = [...new Set([...offices, ...Object.keys(colors), ...Object.keys(shareOffices)])];
  const setIn = (
    map: Record<string, string>,
    save: (m: Record<string, string>) => void,
    name: string,
    value: string | null,
  ) => {
    const next = { ...map };
    if (value) next[name] = value;
    else delete next[name];
    save(next);
  };
  const setColor = (name: string, color: string | null) => setIn(colors, onColors, name, color);
  const noOffices = <p className="text-sm text-slate-500">No offices in this image.</p>;

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
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={
                "border-b-2 px-3 pb-2.5 text-sm font-medium " +
                (tab === t.id
                  ? "border-brand text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-900")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {tab === "columns" && (
            <>
              <p className="text-xs text-slate-500">
                Columns of the image, always in this order. Site is always shown.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALARM_IMAGE_COLUMNS.map((c) => (
                  <label
                    key={c.id}
                    className="flex h-9 items-center gap-2 rounded-md bg-slate-100 px-3 text-slate-900"
                  >
                    <input
                      type="checkbox"
                      checked={columns.includes(c.id)}
                      disabled={c.id === "site"}
                      onChange={(e) =>
                        onColumns(
                          e.target.checked ? [...columns, c.id] : columns.filter((x) => x !== c.id),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}

          {tab === "colours" && (
            <>
              <p className="text-xs text-slate-500">Fill of the Office cell; none = white.</p>
              {names.length === 0 ? (
                noOffices
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {names.map((name) => {
                    const color = colors[name];
                    return (
                      <div
                        key={name}
                        className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5"
                      >
                        <span
                          className="min-w-0 flex-1 truncate rounded-sm px-1.5 py-0.5 text-slate-900"
                          style={color ? { backgroundColor: color, color: "#0f172a" } : undefined}
                        >
                          {name}
                        </span>
                        <input
                          type="color"
                          aria-label={`${name}: colour`}
                          value={color ?? "#ffffff"}
                          onChange={(e) => setColor(name, e.target.value)}
                          className="h-6 w-6 cursor-pointer rounded-sm border-0 bg-transparent p-0"
                        />
                        <button
                          type="button"
                          aria-label={`${name}: no colour`}
                          onClick={() => setColor(name, null)}
                          disabled={!color}
                          className="rounded-sm p-0.5 text-slate-400 hover:text-slate-700 disabled:invisible"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === "share" && linked && (
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
                      name="share-mode"
                      checked={shareMode === mode}
                      onChange={() => onShareMode(mode)}
                    />
                    {text}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {shareMode === "all"
                  ? "Every image goes to this chat."
                  : "Each office's chat gets only that office's images (one click per chat)."}{" "}
                A WhatsApp number or a group invite link (group info → Invite via link). Empty = you
                pick the chat.
              </p>
              {shareMode === "all" ? (
                <div className="max-w-md">
                  <ChatInput
                    value={shareAll}
                    label="All images: number or group link"
                    onChange={onShareAll}
                  />
                </div>
              ) : names.length === 0 ? (
                noOffices
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {names.map((name) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 rounded-md bg-slate-100 px-2 py-1.5"
                    >
                      <span className="w-28 shrink-0 truncate pt-1.5 text-slate-900">{name}</span>
                      <ChatInput
                        value={shareOffices[name] ?? ""}
                        label={`${name}: number or group link`}
                        onChange={(v) => setIn(shareOffices, onShareOffices, name, v || null)}
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

/** Every active alarm of the filters (the API pages at 500). */
async function fetchAll(query: URLSearchParams): Promise<MailAlarm[]> {
  const items: MailAlarm[] = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams(query);
    q.set("page", String(page));
    q.set("pageSize", "500");
    const res = await fetch(`/api/alarms/active?${q}`);
    if (!res.ok) throw new Error(`Could not load the alarms (${res.status})`);
    const data = (await res.json()) as { items: MailAlarm[]; pages: number };
    items.push(...data.items);
    if (page >= data.pages) return items;
  }
}

export function AlarmImageButton({
  query,
  category,
  subtitle,
  pickOffice,
}: {
  /** The page's filters without the category, page and page size. */
  query: URLSearchParams;
  /** Selected category tab: only sites with an alarm of it (their other categories still show). */
  category: string;
  /** Active filters in words, e.g. "Down · Search: KOM". */
  subtitle: string;
  /** Offer "one table per office" (super admin viewing several offices). */
  pickOffice: boolean;
}) {
  const { timeZone, alertHours, office } = useAppConfig();
  const { prefs, update, saveState } = useUiPrefs();
  const opts = prefs.alarms.image;
  const byOffice = pickOffice && opts.byOffice;
  const [open, setOpen] = useState(false);
  const [alarms, setAlarms] = useState<MailAlarm[] | null>(null);
  const [pages, setPages] = useState<ImagePage[]>([]);
  /** Images per office name (for the office chats). */
  const [officePages, setOfficePages] = useState<Record<string, ImagePage[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const queryKey = query.toString();

  const setOpts = (o: Partial<typeof opts>) =>
    update((p) => ({ ...p, alarms: { ...p.alarms, image: { ...p.alarms.image, ...o } } }));

  // load once per opening (and when the filters change while open)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAlarms(null);
    setBusy(true);
    setMsg(null);
    fetchAll(new URLSearchParams(queryKey))
      .then((a) => !cancelled && setAlarms(a))
      .catch((e) => {
        if (cancelled) return;
        setMsg((e as Error).message);
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, queryKey]);

  // the window's own category choice; it starts at the page's tab each time it opens
  const [catChoice, setCatChoice] = useState<AlarmImageCategory>(imageCategoryOf(category));
  useEffect(() => {
    if (open) setCatChoice(imageCategoryOf(category));
  }, [open, category]);
  const choice = ALARM_IMAGE_CATEGORIES.find((c) => c.id === catChoice)!;
  const picked = choiceCategories(catChoice);
  const cats = shownCategories(opts.columns, picked);
  /** Sites of the shown columns, before the category choice. */
  const base = alarms
    ? visibleSiteRows(
        siteImageRows(alarms.map((a) => ({ ...a, labels: a.rawMessage?.labels }))),
        opts.columns,
      )
    : null;
  /** Rows of some categories: their sites, time from those categories, the chosen sort. */
  const rowsOf = (list: SiteImageRow[], c: readonly Category[]) =>
    sortSiteRows(
      withShownTime(sitesWithCategories(list, c), shownCategories(opts.columns, c)),
      opts.sort,
      !byOffice, // one table: grouped by office, the chosen sort inside each
    );
  // every site of the choice (summary, column widths)
  const rows = base ? rowsOf(base, picked) : null;

  useEffect(() => {
    if (!open || !rows) return;
    let cancelled = false;
    const made: ImagePage[] = [];
    setBusy(true);
    (async () => {
      const now = Date.now();
      const cols = ALARM_IMAGE_COLUMNS.filter((c) => opts.columns.includes(c.id));
      const cell = (r: SiteImageRow, id: AlarmImageColumn): [string, string | null] => {
        const cat = markCategory(id);
        if (cat) return [categoryMark(r.counts[cat]), r.counts[cat] ? CATEGORY_FILL[cat] : null];
        const age = ageMinutes(r.alarmTime, now);
        switch (id) {
          case "time":
            return [formatDateTime(r.alarmTime, timeZone), null];
          case "site":
            return [r.site, null];
          case "age":
            return [formatMinutes(age), age > alertHours * 60 ? ALERT_FILL : null];
          case "office": {
            const name = officeName(r.office);
            return [name, opts.officeColors[name]?.slice(1) ?? null];
          }
          case "vip":
            return [r.vip, null];
          case "nodal":
            return [r.nodal, null];
          case "alarms":
            return [r.alarmNames.join(", "), null];
          case "tags":
            return [r.tags.join(" · "), null];
          case "phone":
            return [r.phone ?? "", null];
          default:
            return ["", null];
        }
      };
      const cells = (r: SiteImageRow): ImageRow => {
        const c = cols.map((col) => cell(r, col.id));
        return { text: c.map((x) => x[0]), fill: c.map((x) => x[1]) };
      };
      const headers = cols.map((c) => c.label);
      const center = cols.flatMap((c, i) =>
        markCategory(c.id) || c.id === "vip" || c.id === "nodal" ? [i] : [],
      );
      const widths = columnWidths(headers, rows.map(cells));
      const stamp = formatDateTime(new Date(now), timeZone);
      const scope = office?.split("/").pop() ?? "All offices";
      const perPage = opts.rowsPerImage;
      const split = choice.tables.length > 1;
      /**
       * Draws the pages into `made`: per category table, per office group (when `perOffice`).
       * Returns them per office group label ("" = all offices together).
       */
      const render = async (perOffice: boolean) => {
        const byGroup: Record<string, ImagePage[]> = {};
        const all: ImagePage[] = [];
        for (const t of choice.tables) {
          const tRows = rowsOf(base!, t.cats);
          const tCats = shownCategories(opts.columns, t.cats);
          // a split leaves out an empty category table
          if (split && !tRows.length) continue;
          for (const g of siteImageGroups(tRows, perOffice)) {
            const list: ImagePage[] = (byGroup[g.label] ??= []);
            const n = Math.max(1, Math.ceil(g.rows.length / perPage));
            const head = `Active alarms · ${g.label || scope} · ${stamp}`;
            const alarmCount = shownAlarmCount(g.rows, tCats);
            const sub = [t.label, subtitle].filter(Boolean).join(" · ");
            const part = slug([t.label, g.label].filter(Boolean).join(" "));
            for (let i = 0; i < n && !cancelled; i++) {
              const slice = g.rows.slice(i * perPage, (i + 1) * perPage);
              const range = g.rows.length
                ? `sites ${i * perPage + 1}–${i * perPage + slice.length} of ${g.rows.length} · ${alarmCount} alarm${alarmCount === 1 ? "" : "s"}`
                : "no active alarms";
              const blob = await drawTable({
                rows: slice.map(cells),
                headers,
                widths,
                center,
                title: n > 1 ? `${head}  (${i + 1}/${n})` : head,
                subtitle: sub,
                footer: `${range} · Alarm Filter`,
              });
              const name = `alarms-${slug(stamp)}${part ? `-${part}` : ""}${n > 1 ? `-${i + 1}of${n}` : ""}.png`;
              const page = {
                file: new File([blob], name, { type: "image/png" }),
                url: URL.createObjectURL(blob),
              };
              made.push(page);
              list.push(page);
              all.push(page);
            }
          }
        }
        return { byGroup, all };
      };
      const shown = await render(byOffice);
      // office chats get only their office's images: drawn separately when the shown images
      // put every office in one table
      const perOffice = byOffice || opts.shareMode !== "office" ? shown : await render(true);

      if (!cancelled) {
        setPages(shown.all);
        setOfficePages(byOffice || opts.shareMode === "office" ? perOffice.byGroup : {});
      }
    })()
      .catch((e) => !cancelled && setMsg((e as Error).message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      made.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // rows is derived from alarms + category
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alarms, category, opts, byOffice, catChoice, timeZone, alertHours, office]);

  // office chats first (their own images), then the chat that gets every image
  const targets: ShareTarget[] =
    opts.shareMode === "office"
      ? Object.entries(opts.shareOffices)
          .filter(([name]) => officePages[name]?.length)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, chat]) => ({ label: name, chat, pages: officePages[name]! }))
      : opts.shareAll
        ? [{ label: "All images", chat: opts.shareAll, pages }]
        : [];

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <ImageIcon className="h-4 w-4" />
        Export image
      </Button>
      {open && (
        <ImageExportDialog
          title="Active alarms as image"
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
              title="Office colours and share chats"
              className={
                "rounded-md p-1.5 hover:bg-slate-100 hover:text-slate-900 " +
                (settingsOpen ? "bg-slate-100 text-brand" : "text-slate-500")
              }
            >
              <Settings className="h-5 w-5" />
            </button>
          }
          summary={
            rows && (
              <>
                {shownAlarmCount(rows, cats).toLocaleString("en-US")} alarms · {rows.length} sites →{" "}
                {pages.length} image{pages.length === 1 ? "" : "s"}
                {saveState !== "idle" && (
                  <span className={saveState === "error" ? "text-red-700" : "text-slate-500"}>
                    {" · "}
                    {saveState === "saving"
                      ? "Saving settings…"
                      : saveState === "saved"
                        ? "Settings saved"
                        : "Settings not saved"}
                  </span>
                )}
              </>
            )
          }
          controls={
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Category</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={catChoice}
                  onChange={(e) => setCatChoice(e.target.value as AlarmImageCategory)}
                >
                  {ALARM_IMAGE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Rows per image</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={opts.rowsPerImage}
                  onChange={(e) => setOpts({ rowsPerImage: Number(e.target.value) })}
                >
                  {ALARM_IMAGE_ROWS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Sort</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={opts.sort}
                  onChange={(e) => setOpts({ sort: e.target.value as AlarmImageSort })}
                >
                  {ALARM_IMAGE_SORTS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {pickOffice && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Offices</span>
                  <select
                    className="h-9 rounded-md border border-input bg-white px-2"
                    value={opts.byOffice ? "each" : "one"}
                    onChange={(e) => setOpts({ byOffice: e.target.value === "each" })}
                  >
                    <option value="one">All offices in one table</option>
                    <option value="each">One table per office</option>
                  </select>
                </label>
              )}
              {settingsOpen && (
                <ImageSettings
                  offices={[...new Set((alarms ?? []).map((a) => officeName(a.office)))]
                    .filter(Boolean)
                    .sort()}
                  columns={opts.columns}
                  onColumns={(columns) => setOpts({ columns })}
                  colors={opts.officeColors}
                  shareAll={opts.shareAll}
                  shareOffices={opts.shareOffices}
                  onColors={(officeColors) => setOpts({ officeColors })}
                  onShareAll={(shareAll) => setOpts({ shareAll })}
                  onShareOffices={(shareOffices) => setOpts({ shareOffices })}
                  shareMode={opts.shareMode}
                  onShareMode={(shareMode) => setOpts({ shareMode })}
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

"use client";

import { ChevronDown, Eye, EyeOff, MapPin, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CategoryBadge } from "@/components/badges";
import { AccordionSection } from "@/components/settings/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Cat = "DOWN" | "POWER" | "OTHER";
interface Filter {
  /** No longer edited here (2026-10-27); an old value can still be cleared. */
  hiddenCategories: Cat[];
  hiddenAlarmNames: string[];
  /** Alarm name → site codes / full site names where it is flipped (hidden ↔ shown). */
  siteExceptions: Record<string, string[]>;
}
interface NameRow {
  name: string;
  category: Cat;
  count: number;
}

const EMPTY: Filter = { hiddenCategories: [], hiddenAlarmNames: [], siteExceptions: {} };

/** Site codes ("0H31DE") or full site names of one alarm name. */
export function SiteList({
  value,
  onChange,
  hidden,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  /** The alarm is hidden: these sites still show it. Else: these sites hide it. */
  hidden: boolean;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const items = text
      .split(/[,\s]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (items.length) onChange([...new Set([...value, ...items])]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {hidden ? (
          <>
            <b className="text-slate-700">Still show</b> this alarm at these sites
          </>
        ) : (
          <>
            <b className="text-slate-700">Hide</b> this alarm at these sites
          </>
        )}{" "}
        — a site code (e.g. 0H31DE) or the full site name; several separated by spaces or commas.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Site code or full site name"
          className="h-8 w-64 bg-white font-mono uppercase"
          aria-label="Site to add"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="bg-white"
          disabled={!text.trim()}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((site) => (
            <span
              key={site}
              className="inline-flex items-center gap-1 rounded-sm border border-slate-200 bg-white py-0.5 pl-2 pr-1 font-mono text-xs text-slate-700"
            >
              {site}
              <button
                type="button"
                aria-label={`Remove ${site}`}
                onClick={() => onChange(value.filter((x) => x !== site))}
                className="rounded-sm p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function VisibilityButton({
  shown,
  onClick,
  label,
}: {
  shown: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={(shown ? "Hide " : "Show ") + label}
      title={shown ? "Shown — click to hide" : "Hidden — click to show"}
      className={cn(
        "flex w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
        shown
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200",
      )}
    >
      {shown ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {shown ? "Shown" : "Hidden"}
    </button>
  );
}

function Locked({ text }: { text: string }) {
  return <span className="w-[5.5rem] shrink-0 text-right text-[11px] text-slate-400">{text}</span>;
}

/**
 * Hide/show alarm names, each with its own site exceptions (the name does the opposite there).
 * - `admin`: for everyone (PUT /api/settings/display).
 * - `personal`: on this user's pages only (PUT /api/me/display); names the admin already hides
 *   are shown as locked.
 */
export function TypesVisibilityEditor({ mode }: { mode: "admin" | "personal" }) {
  const endpoint = mode === "admin" ? "/api/settings/display" : "/api/me/display";
  const current = usePoll<Filter & { admin?: Filter }>(endpoint, 0);
  const names = usePoll<{ names: NameRow[] }>("/api/alarm-names?all=1", 0);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current.data && !filter) {
      setFilter({
        hiddenCategories: current.data.hiddenCategories,
        hiddenAlarmNames: current.data.hiddenAlarmNames,
        siteExceptions: current.data.siteExceptions ?? {},
      });
    }
  }, [current.data, filter]);
  if (!filter) return null;

  const admin = mode === "personal" ? (current.data?.admin ?? EMPTY) : EMPTY;
  const adminHides = (n: NameRow) =>
    admin.hiddenCategories.includes(n.category) || admin.hiddenAlarmNames.includes(n.name);
  const catHidden = (c: Cat) => filter.hiddenCategories.includes(c);
  const nameHidden = (n: string) => filter.hiddenAlarmNames.includes(n);
  const sitesOf = (n: string) => filter.siteExceptions[n] ?? [];
  const toggleName = (n: string) =>
    setFilter({
      ...filter,
      hiddenAlarmNames: nameHidden(n)
        ? filter.hiddenAlarmNames.filter((x) => x !== n)
        : [...filter.hiddenAlarmNames, n],
    });
  const setSites = (n: string, sites: string[]) => {
    const rest = { ...filter.siteExceptions };
    delete rest[n];
    setFilter({ ...filter, siteExceptions: sites.length ? { ...rest, [n]: sites } : rest });
  };

  const query = q.trim().toUpperCase();
  const all = names.data?.names ?? [];
  /** Hidden, or with site exceptions — what "Changed only" lists. */
  const changedRow = (n: NameRow) =>
    adminHides(n) || catHidden(n.category) || nameHidden(n.name) || sitesOf(n.name).length > 0;
  const changedN = all.filter(changedRow).length;
  const rows = all.filter(
    (n) => (!query || n.name.toUpperCase().includes(query)) && (!onlyChanged || changedRow(n)),
  );
  const saved = {
    hiddenCategories: current.data?.hiddenCategories ?? [],
    hiddenAlarmNames: current.data?.hiddenAlarmNames ?? [],
    siteExceptions: current.data?.siteExceptions ?? {},
  };
  const changed = JSON.stringify(filter) !== JSON.stringify(saved);
  const exceptionN = Object.keys(filter.siteExceptions).length;
  const anyChange =
    filter.hiddenCategories.length > 0 || filter.hiddenAlarmNames.length > 0 || exceptionN > 0;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      window.location.reload(); // pages + the "hidden" note pick up the new filter
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const hiddenN = filter.hiddenCategories.length + filter.hiddenAlarmNames.length;
  const summary = [
    hiddenN ? `${hiddenN} hidden` : "nothing hidden",
    exceptionN ? `${exceptionN} with site exceptions` : "",
    changed ? "not saved" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <AccordionSection
      title={mode === "admin" ? "Hidden for everyone" : "Hidden from my pages"}
      summary={summary}
      description={
        <>
          {mode === "admin" ? "Hides alarms for all users" : "Hides alarms for you only"} — on every
          page, export and notification. <b>Sites</b>: a hidden alarm still shows there, a shown one
          is hidden.
        </>
      }
      contentClassName="space-y-4"
      action={
        <div className="flex shrink-0 items-center gap-2">
          {anyChange && (
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => setFilter({ ...EMPTY })}
            >
              Reset
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {msg && <p className="text-sm text-red-700">{msg}</p>}
      {filter.hiddenCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Whole categories hidden (older setting):
          {filter.hiddenCategories.map((c) => (
            <CategoryBadge key={c} value={c} />
          ))}
          <button
            type="button"
            className="underline"
            onClick={() => setFilter({ ...filter, hiddenCategories: [] })}
          >
            Show them again
          </button>
        </div>
      )}
      <div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Alarm names (last 30 days in this office)
          </span>
          <div className="flex items-center gap-2">
            <div className="inline-flex shrink-0 rounded-md border border-slate-200 p-0.5 text-xs">
              {([false, true] as const).map((only) => (
                <button
                  key={String(only)}
                  type="button"
                  aria-pressed={onlyChanged === only}
                  onClick={() => setOnlyChanged(only)}
                  className={cn(
                    "rounded-sm px-2.5 py-1",
                    onlyChanged === only
                      ? "bg-brand text-white"
                      : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {only ? `Changed (${changedN})` : "All"}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="bg-white pl-8"
              />
            </div>
          </div>
        </div>
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {rows.map((n) => {
            const lockedByAdmin = adminHides(n);
            const byCategory = catHidden(n.category);
            const hidden = lockedByAdmin || byCategory || nameHidden(n.name);
            const sites = sitesOf(n.name);
            const open = openName === n.name;
            const { name, prefix } = splitAlarmName(n.name);
            return (
              <div key={n.name} className={cn(hidden && !open && "bg-slate-50")}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      hidden ? "text-slate-400 line-through" : "text-slate-900",
                    )}
                    title={n.name}
                  >
                    {name}
                    {prefix && (
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400">{prefix}</span>
                    )}
                  </span>
                  <CategoryBadge value={n.category} />
                  <span className="hidden w-12 text-right text-xs tabular-nums text-slate-400 sm:inline">
                    {n.count}
                  </span>
                  {!lockedByAdmin && (
                    <button
                      type="button"
                      onClick={() => setOpenName(open ? null : n.name)}
                      aria-expanded={open}
                      title={hidden ? "Sites where it still shows" : "Sites where it is hidden"}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                        sites.length
                          ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                          : "border-slate-200 text-slate-500 hover:bg-slate-100",
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {sites.length
                        ? `${sites.length} site${sites.length === 1 ? "" : "s"}`
                        : "Sites"}
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
                      />
                    </button>
                  )}
                  {lockedByAdmin ? (
                    <Locked text="hidden by admin" />
                  ) : byCategory ? (
                    <Locked text="via category" />
                  ) : (
                    <VisibilityButton
                      shown={!nameHidden(n.name)}
                      onClick={() => toggleName(n.name)}
                      label={n.name}
                    />
                  )}
                </div>
                {open && (
                  <div className="border-t border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                    <SiteList value={sites} hidden={hidden} onChange={(v) => setSites(n.name, v)} />
                  </div>
                )}
              </div>
            );
          })}
          {names.data && !rows.length && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {onlyChanged ? "No alarm is hidden or has site exceptions." : "No alarm names match."}
            </p>
          )}
        </div>
      </div>
    </AccordionSection>
  );
}

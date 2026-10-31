"use client";

// Settings → Display alarms (per user, users.uiPrefs.alarms): Table / Mail view, the mail card
// (its parts and folding repeated site codes), the table's site details, rows and columns, and
// the hidden alarm types (mine, and for everyone — super admin) with their site exceptions.
// The view is a picker at the top; the rest is a gap accordion in two groups (layout, hidden
// types). The section of the chosen view is marked "In use", comes first and is open at first;
// one section is open at a time. No previews (user, 2026-10-27).
import { Check, EyeOff, Lock, Mail, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { ALARM_COLUMNS, MAIL_PARTS, type AlarmTable, type UiPrefs } from "@alarm/core";
import { useAppConfig } from "@/components/app-config";
import { AccordionGroup, AccordionSection } from "@/components/settings/accordion";
import { SectionHeader, Toggle } from "@/components/settings/section";
import { TypesVisibilityEditor } from "@/components/types-visibility-editor";
import { useUiPrefs } from "@/components/ui-prefs";
import { cn } from "@/lib/utils";

const TABLE_LABEL: Record<AlarmTable, string> = {
  active: "Active alarms",
  cleared: "Cleared alarms",
};
const SITE_INFO_COLUMNS = new Set(["nodality", "battery"]);

type Alarms = UiPrefs["alarms"];
type View = Alarms["view"];

function useAlarmPrefs() {
  const { prefs, update } = useUiPrefs();
  const set = (patch: Partial<Alarms>) =>
    update((p) => ({ ...p, alarms: { ...p.alarms, ...patch } }));
  return { a: prefs.alarms, set, update };
}

const VIEWS: { id: View; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "mail",
    label: "Mail cards",
    hint: "Gmail-style cards with the real subject, tags and a call button",
    icon: <Mail className="h-5 w-5" />,
  },
  {
    id: "table",
    label: "Table",
    hint: "Compact rows with the columns you choose",
    icon: <Table2 className="h-5 w-5" />,
  },
];

/** Table / Mail as two cards — the main choice of the page, always visible. */
function ViewPicker() {
  const { a, set } = useAlarmPrefs();
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="View">
      {VIEWS.map((v) => {
        const on = a.view === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => set({ view: v.id })}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-white p-4 text-left shadow-sm transition-colors",
              on ? "border-brand ring-1 ring-brand" : "border-slate-200 hover:border-slate-300",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                on ? "bg-brand text-white" : "bg-slate-100 text-slate-500",
              )}
            >
              {v.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">{v.label}</span>
              <span className="block text-sm text-slate-500">{v.hint}</span>
            </span>
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                on ? "border-brand bg-brand text-white" : "border-slate-300",
              )}
            >
              {on && <Check className="h-3 w-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "In use" on the section of the chosen view. */
function InUse({ on }: { on: boolean }) {
  return on ? (
    <span className="shrink-0 rounded-sm bg-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-brand">
      In use
    </span>
  ) : null;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h3>
  );
}

/** Sub-heading inside a section. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

function MailSection() {
  const { a, set } = useAlarmPrefs();
  const on = MAIL_PARTS.filter((p) => a.mail[p.id]).length;
  return (
    <AccordionSection
      title="Mail cards"
      icon={<Mail className="h-4 w-4" />}
      badge={<InUse on={a.view === "mail"} />}
      summary={`${on} of ${MAIL_PARTS.length} parts${a.mailGroupBySite ? " · grouped by site" : ""}`}
      contentClassName="space-y-4"
    >
      <Part title="Parts of a card">
        <p className="-mt-1 text-xs text-slate-500">The mail subject is always shown.</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {MAIL_PARTS.map((part) => (
            <Toggle
              key={part.id}
              label={part.label}
              hint={part.hint}
              checked={a.mail[part.id]}
              onChange={(v) => set({ mail: { ...a.mail, [part.id]: v } })}
            />
          ))}
        </div>
      </Part>
      <div className="border-t border-slate-100 pt-4">
        <Toggle
          label="Group alarms of the same site"
          hint="Several alarms of one site code fold into one card with the site, its tags and the alarm count — click it to open them (current page)."
          checked={a.mailGroupBySite}
          onChange={(v) => set({ mailGroupBySite: v })}
        />
      </div>
    </AccordionSection>
  );
}

/** Table view: site details, rows and columns in one section. */
function TableSection() {
  const { a, set, update } = useAlarmPrefs();
  const [table, setTable] = useState<AlarmTable>("active");
  const hidden = new Set(a.hiddenColumns[table]);
  const icons = a.siteInfoIcons;
  const count = (t: AlarmTable) => a.hiddenColumns[t].length;
  const hiddenTotal = count("active") + count("cleared");

  const setHidden = (id: string, hide: boolean) =>
    update((p) => {
      const list = p.alarms.hiddenColumns[table].filter((c) => c !== id);
      return {
        ...p,
        alarms: {
          ...p.alarms,
          hiddenColumns: { ...p.alarms.hiddenColumns, [table]: hide ? [...list, id] : list },
        },
      };
    });

  return (
    <AccordionSection
      title="Table"
      icon={<Table2 className="h-4 w-4" />}
      badge={<InUse on={a.view === "table"} />}
      summary={[
        a.siteInfoIcons ? "site tags" : "VIP badge + columns",
        a.groupBySite ? "one row per site" : "one row per alarm",
        hiddenTotal ? `${hiddenTotal} column${hiddenTotal === 1 ? "" : "s"} hidden` : "all columns",
      ].join(" · ")}
      contentClassName="space-y-5"
    >
      <Part title="Site details">
        <Toggle
          label="VIP, Nodal, Battery and Generator as tags"
          hint="Small VIP / NODAL / BATT / GEN tags next to the site (only the ones it has) instead of the VIP badge and the Nodality / Battery columns. Hover a tag to read its value."
          checked={a.siteInfoIcons}
          onChange={(v) => set({ siteInfoIcons: v })}
        />
      </Part>

      <div className="border-t border-slate-100 pt-4">
        <Toggle
          label="One row per site code"
          hint="Alarms of the same site code are shown once with a counter; click the row to open the others (rows of the current page)."
          checked={a.groupBySite}
          onChange={(v) => set({ groupBySite: v })}
        />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <Part title="Columns">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-sm">
              {(Object.keys(TABLE_LABEL) as AlarmTable[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTable(t)}
                  className={cn(
                    "rounded-sm px-3 py-1",
                    t === table ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {TABLE_LABEL[t]}
                  {count(t) > 0 && (
                    <span className="ml-1.5 text-xs opacity-80">{count(t)} hidden</span>
                  )}
                </button>
              ))}
            </div>
            {hidden.size > 0 && (
              <button
                type="button"
                className="text-sm text-sky-700 underline"
                onClick={() =>
                  update((p) => ({
                    ...p,
                    alarms: {
                      ...p.alarms,
                      hiddenColumns: { ...p.alarms.hiddenColumns, [table]: [] },
                    },
                  }))
                }
              >
                Show all columns again
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ALARM_COLUMNS[table].map((c) => {
              const asIcon = icons && SITE_INFO_COLUMNS.has(c.id);
              const shown = !hidden.has(c.id);
              const locked = c.required || asIcon;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={locked}
                  onClick={() => setHidden(c.id, shown)}
                  aria-pressed={shown}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    locked
                      ? "cursor-default border-slate-200 text-slate-500"
                      : shown
                        ? "border-brand bg-brand/10 text-slate-900"
                        : "border-slate-200 text-slate-500 hover:bg-slate-100",
                  )}
                >
                  <span>
                    {c.label}
                    {asIcon && (
                      <span className="block text-[11px]">shown as a tag next to the site</span>
                    )}
                    {c.required && <span className="block text-[11px]">always shown</span>}
                  </span>
                  {locked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  ) : (
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        shown ? "border-brand bg-brand text-white" : "border-slate-300",
                      )}
                    >
                      {shown && <Check className="h-3 w-3" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Part>
      </div>
    </AccordionSection>
  );
}

export default function DisplaySettings() {
  const { role } = useAppConfig();
  const { a } = useAlarmPrefs();
  // the section of the chosen view comes first
  const mail = <MailSection key="mail" />;
  const table = <TableSection key="table" />;
  return (
    <>
      <SectionHeader
        title="Display alarms"
        subtitle="How the Alarms and Cleared pages look for you — saved to your account only."
      />
      <AccordionGroup defaultOpen={a.view === "mail" ? "Mail cards" : "Table"}>
        <div className="space-y-3">
          <GroupLabel>View</GroupLabel>
          <ViewPicker />
          <GroupLabel>Layout</GroupLabel>
          {a.view === "mail" ? [mail, table] : [table, mail]}
          <GroupLabel>
            <EyeOff className="h-3.5 w-3.5" /> Hidden alarm types
          </GroupLabel>
          <TypesVisibilityEditor mode="personal" />
          {role === "SUPER_ADMIN" && <TypesVisibilityEditor mode="admin" />}
        </div>
      </AccordionGroup>
    </>
  );
}

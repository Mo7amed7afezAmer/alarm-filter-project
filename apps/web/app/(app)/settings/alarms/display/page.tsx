"use client";

// Settings → Display alarms (per user, users.uiPrefs.alarms): Table / Mail view, the mail card
// (its parts and folding repeated site codes), the table's site details, rows and columns, and
// the hidden alarm types (mine, and for everyone — super admin) with their site exceptions.
// The sections are a gap accordion.
import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { ALARM_COLUMNS, MAIL_PARTS, type AlarmTable, type UiPrefs } from "@alarm/core";
import { SiteCell, type SiteMasterInfo } from "@/components/alarm-bits";
import { AlarmMailList, ViewSwitch, type MailAlarm } from "@/components/alarm-mail";
import { useAppConfig } from "@/components/app-config";
import { AccordionSection } from "@/components/settings/accordion";
import { SectionHeader, Toggle } from "@/components/settings/section";
import { TypesVisibilityEditor } from "@/components/types-visibility-editor";
import { useUiPrefs } from "@/components/ui-prefs";
import { cn } from "@/lib/utils";

const TABLE_LABEL: Record<AlarmTable, string> = {
  active: "Active alarms",
  cleared: "Cleared alarms",
};
const SITE_INFO_COLUMNS = new Set(["nodality", "battery"]);

const SAMPLE: SiteMasterInfo = {
  siteCode: "0H31DE",
  vip: true,
  nodality: "1+2",
  battery: "YES",
  phone: null,
  powerSource: "EC+DG",
};

const SITE = "SRAN_S_BH-QMB-LOQIN_0H31DE";
const mail = (
  id: number,
  alarmName: string,
  minutesAgo: number,
  cellName: string | null,
): MailAlarm => ({
  ...SAMPLE,
  id,
  alarmName,
  site: SITE,
  category: "DOWN",
  alarmTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  cellName,
  device: cellName ? "cell" : "MRBTS",
  office: null,
  powerSource: "EC+DG",
  phone: "01000000000",
  rawMessage: {
    subject: `${alarmName} on #${SITE}# at |25-OCT-2026 09:51:54 |`,
    receivedAt: new Date(Date.now() - (minutesAgo - 2) * 60_000).toISOString(),
    labels: ["Out of Area"],
  },
});
/** Mail card preview with the user's settings: two alarms of one site (shows the folding). */
const SAMPLE_MAILS: MailAlarm[] = [
  mail(1, "S_D_N_BTS O&M LINK FAILURE", 95, null),
  mail(2, "S_D_N_WCDMA CELL OUT OF USE", 90, "A_BH-QMB-LOQIN_3_24313_S"),
];

type Alarms = UiPrefs["alarms"];

function useAlarmPrefs() {
  const { prefs, update } = useUiPrefs();
  const set = (patch: Partial<Alarms>) =>
    update((p) => ({ ...p, alarms: { ...p.alarms, ...patch } }));
  return { a: prefs.alarms, set, update };
}

function ViewSection() {
  const { a, set } = useAlarmPrefs();
  return (
    <AccordionSection
      title="View"
      defaultOpen
      summary={a.view === "mail" ? "Mail" : "Table"}
      description="How the Alarms and Cleared pages list alarms: table rows, or Gmail-style mail cards."
    >
      <ViewSwitch value={a.view} onChange={(view) => set({ view })} />
    </AccordionSection>
  );
}

function MailSection() {
  const { timeZone } = useAppConfig();
  const { a, set } = useAlarmPrefs();
  const on = MAIL_PARTS.filter((p) => a.mail[p.id]).length;
  return (
    <AccordionSection
      title="Mail cards"
      summary={`${on} of ${MAIL_PARTS.length} parts${a.mailGroupBySite ? " · grouped by site" : ""}`}
      description="The mail subject is always shown; pick the other parts of a card."
      contentClassName="space-y-4"
    >
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
      <div className="rounded-md border border-slate-200 px-3 py-2.5">
        <Toggle
          label="Group alarms of the same site"
          hint="When a site code has several alarms, they fold into one card with the site, its tags and the alarm count — click it to open the alarms (current page)."
          checked={a.mailGroupBySite}
          onChange={(v) => set({ mailGroupBySite: v })}
        />
      </div>
      <div className="rounded-md border border-dashed border-slate-300 p-3">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Preview
        </span>
        <AlarmMailList
          items={SAMPLE_MAILS}
          now={Date.now()}
          timeZone={timeZone}
          empty=""
          age={(m) => (
            <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {m.id === 1 ? "1h 35m" : "1h 30m"}
            </span>
          )}
        />
      </div>
    </AccordionSection>
  );
}

function SiteDetailsSection() {
  const { a, set } = useAlarmPrefs();
  return (
    <AccordionSection
      title="Table · site details"
      summary={a.siteInfoIcons ? "tags next to the site" : "VIP badge + Nodality / Battery columns"}
      contentClassName="space-y-4"
    >
      <Toggle
        label="VIP, Nodal, Battery and Generator as tags"
        hint="Small VIP / NODAL / BATT / GEN tags next to the site (only the ones it has) instead of the VIP badge and the Nodality / Battery columns. Hover a tag to read its value."
        checked={a.siteInfoIcons}
        onChange={(v) => set({ siteInfoIcons: v })}
      />
      <div className="rounded-md border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500">
        <span className="mb-1.5 block font-medium uppercase tracking-wide">Preview</span>
        <SiteCell site={SITE} vip={SAMPLE.vip} info={SAMPLE} icons={a.siteInfoIcons} />
        {!a.siteInfoIcons && (
          <span className="ml-3">
            · Nodality <b className="text-slate-700">{SAMPLE.nodality}</b> · Battery{" "}
            <b className="text-slate-700">{SAMPLE.battery}</b> (columns)
          </span>
        )}
      </div>
    </AccordionSection>
  );
}

function RowsSection() {
  const { a, set } = useAlarmPrefs();
  return (
    <AccordionSection
      title="Table · rows"
      summary={a.groupBySite ? "one row per site code" : "one row per alarm"}
    >
      <Toggle
        label="One row per site code"
        hint="Alarms of the same site code are shown once with a counter; click the row to open the others (applies to the rows of the current page)."
        checked={a.groupBySite}
        onChange={(v) => set({ groupBySite: v })}
      />
    </AccordionSection>
  );
}

function ColumnsSection() {
  const { a, update } = useAlarmPrefs();
  const [table, setTable] = useState<AlarmTable>("active");
  const hidden = new Set(a.hiddenColumns[table]);
  const icons = a.siteInfoIcons;
  const count = (t: AlarmTable) => a.hiddenColumns[t].length;

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
      title="Table · columns"
      summary={
        count("active") + count("cleared")
          ? `${count("active")} hidden on Active, ${count("cleared")} on Cleared`
          : "every column shown"
      }
      description="Choose the columns of each alarm table."
      contentClassName="space-y-3"
    >
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
          </button>
        ))}
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
      {hidden.size > 0 && (
        <button
          type="button"
          className="text-sm text-sky-700 underline"
          onClick={() =>
            update((p) => ({
              ...p,
              alarms: { ...p.alarms, hiddenColumns: { ...p.alarms.hiddenColumns, [table]: [] } },
            }))
          }
        >
          Show all columns again
        </button>
      )}
    </AccordionSection>
  );
}

export default function DisplaySettings() {
  const { role } = useAppConfig();
  return (
    <>
      <SectionHeader
        title="Display alarms"
        subtitle="How the Alarms and Cleared pages look for you — saved to your account only."
      />
      <div className="space-y-3">
        <ViewSection />
        <MailSection />
        <SiteDetailsSection />
        <RowsSection />
        <ColumnsSection />
        <TypesVisibilityEditor mode="personal" />
        {role === "SUPER_ADMIN" && <TypesVisibilityEditor mode="admin" />}
      </div>
    </>
  );
}

"use client";

import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { ALARM_COLUMNS, MAIL_PARTS, type AlarmTable, type UiPrefs } from "@alarm/core";
import { SiteCell, type SiteMasterInfo } from "@/components/alarm-bits";
import { AlarmMailList, ViewSwitch, type MailAlarm } from "@/components/alarm-mail";
import { useAppConfig } from "@/components/app-config";
import { SectionHeader, Toggle } from "@/components/settings/section";
import { TypesVisibilityEditor } from "@/components/types-visibility-editor";
import { useUiPrefs } from "@/components/ui-prefs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/** Mail card preview with the user's settings. */
const SAMPLE_MAIL: MailAlarm = {
  ...SAMPLE,
  id: 0,
  alarmName: "S_D_N_BTS O&M LINK FAILURE",
  site: "SRAN_S_BH-QMB-LOQIN_0H31DE",
  category: "DOWN",
  alarmTime: new Date(Date.now() - 95 * 60_000).toISOString(),
  cellName: "A_BH-QMB-LOQIN_3_24313_S",
  device: "cell",
  office: null,
  powerSource: "EC+DG",
  phone: "01000000000",
  rawMessage: {
    subject:
      "S_D_N_BTS O&M LINK FAILURE on #SRAN_S_BH-QMB-LOQIN_0H31DE# at |25-OCT-2026 09:51:54 |",
    receivedAt: new Date(Date.now() - 93 * 60_000).toISOString(),
    labels: ["Out of Area"],
  },
};

function MailCard() {
  const { timeZone } = useAppConfig();
  const { prefs, update } = useUiPrefs();
  const mail = prefs.alarms.mail;
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">View</CardTitle>
          <p className="text-sm text-slate-500">
            How the Alarms and Cleared pages list alarms. The mail subject is always shown; pick the
            other parts of a mail card.
          </p>
        </div>
        <ViewSwitch
          value={prefs.alarms.view}
          onChange={(view) => update((p) => ({ ...p, alarms: { ...p.alarms, view } }))}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {MAIL_PARTS.map((part) => (
            <Toggle
              key={part.id}
              label={part.label}
              hint={part.hint}
              checked={mail[part.id]}
              onChange={(v) =>
                update((p) => ({
                  ...p,
                  alarms: { ...p.alarms, mail: { ...p.alarms.mail, [part.id]: v } },
                }))
              }
            />
          ))}
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 p-3">
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Preview
          </span>
          <AlarmMailList
            items={[SAMPLE_MAIL]}
            now={Date.now()}
            timeZone={timeZone}
            empty=""
            age={() => (
              <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                1h 35m
              </span>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}

type Alarms = UiPrefs["alarms"];

function ColumnsCard() {
  const { prefs, update } = useUiPrefs();
  const [table, setTable] = useState<AlarmTable>("active");
  const hidden = new Set(prefs.alarms.hiddenColumns[table]);
  const icons = prefs.alarms.siteInfoIcons;

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
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Columns</CardTitle>
          <p className="text-sm text-slate-500">Choose the columns of each alarm table.</p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5 text-sm">
          {(Object.keys(TABLE_LABEL) as AlarmTable[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTable(t)}
              className={cn(
                "rounded-md px-3 py-1",
                t === table ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {TABLE_LABEL[t]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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
                  "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
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
                    <span className="block text-[11px]">shown as an icon next to the site</span>
                  )}
                  {c.required && <span className="block text-[11px]">always shown</span>}
                </span>
                {locked ? (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : (
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
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
      </CardContent>
    </Card>
  );
}

export default function DisplaySettings() {
  const { role } = useAppConfig();
  const { prefs, update } = useUiPrefs();
  const set = (patch: Partial<Alarms>) =>
    update((p) => ({ ...p, alarms: { ...p.alarms, ...patch } }));

  return (
    <>
      <SectionHeader
        title="Display alarms"
        subtitle="How the Alarms and Cleared pages look for you — saved to your account only."
      />

      <MailCard />

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card className="rounded-xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Site details (table)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle
              label="VIP, Nodal, Battery and Generator as tags"
              hint="Small VIP / NODAL / BATT / GEN tags next to the site (only the ones it has) instead of the VIP badge and the Nodality / Battery columns. Hover a tag to read its value."
              checked={prefs.alarms.siteInfoIcons}
              onChange={(v) => set({ siteInfoIcons: v })}
            />
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500">
              <span className="mb-1.5 block font-medium uppercase tracking-wide">Preview</span>
              <SiteCell
                site="SRAN_S_BH-QMB-LOQIN_0H31DE"
                vip={SAMPLE.vip}
                info={SAMPLE}
                icons={prefs.alarms.siteInfoIcons}
              />
              {!prefs.alarms.siteInfoIcons && (
                <span className="ml-3">
                  · Nodality <b className="text-slate-700">{SAMPLE.nodality}</b> · Battery{" "}
                  <b className="text-slate-700">{SAMPLE.battery}</b> (columns)
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Rows (table)</CardTitle>
          </CardHeader>
          <CardContent>
            <Toggle
              label="One row per site code"
              hint="Alarms of the same site code are shown once with a counter; click the row to open the others (applies to the rows of the current page)."
              checked={prefs.alarms.groupBySite}
              onChange={(v) => set({ groupBySite: v })}
            />
          </CardContent>
        </Card>
      </div>

      <ColumnsCard />

      <TypesVisibilityEditor mode="personal" />
      {role === "SUPER_ADMIN" && <TypesVisibilityEditor mode="admin" />}
    </>
  );
}

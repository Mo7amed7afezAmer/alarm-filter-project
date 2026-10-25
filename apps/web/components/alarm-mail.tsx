"use client";

// Gmail-style alarm list (the "Mail" view of /alarms and /cleared): the mail subject with its
// chips (ALM / CLR, the site tags VIP / NODAL / BATT / GEN, other Gmail labels), the age
// top-right, cell / device and a call button bottom-right. Which parts show is a per-user
// setting (uiPrefs.alarms.mail, /settings/alarms/display).
import { mailChips, siteTags, type ChipKind, type MailPart } from "@alarm/core";
import { Mail, Phone, RadioTower, Server } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CATEGORY_STRIPE, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SiteMasterInfo } from "./alarm-bits";
import { CategoryBadge } from "./badges";
import { useUiPrefs } from "./ui-prefs";

export interface AlarmMail {
  subject: string;
  receivedAt: string;
  labels: string[];
}

export interface MailAlarm extends SiteMasterInfo {
  id: number;
  alarmName: string;
  site: string;
  category: string;
  alarmTime: string;
  clearTime?: string | null;
  cellName: string | null;
  device: string | null;
  office: string | null;
  powerSource: string | null;
  rawMessage: AlarmMail | null;
  clearMessage?: AlarmMail | null;
}

export const CHIP: Record<ChipKind, string> = {
  ALM: "bg-red-600 text-white",
  CLR: "bg-emerald-600 text-white",
  VIP: "bg-sky-100 text-sky-700",
  NODAL: "bg-pink-100 text-pink-700",
  BATT: "bg-emerald-100 text-emerald-700",
  GEN: "bg-violet-600 text-white",
  label: "bg-slate-100 text-slate-600",
};

export function Chip({
  className,
  title,
  children,
}: {
  className: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-semibold leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

type SiteTagInfo = {
  vip: boolean | null;
  nodality: string | null;
  battery: string | null;
  powerSource?: string | null;
};

const CHIP_TITLE: Partial<Record<ChipKind, (a: SiteTagInfo) => string>> = {
  VIP: () => "VIP site",
  NODAL: (a) => `Nodal site${a.nodality ? ` · nodality ${a.nodality}` : ""}`,
  BATT: (a) => `Battery: ${a.battery}`,
  GEN: (a) => `Generator${a.powerSource ? ` · power source ${a.powerSource}` : ""}`,
};

/** VIP / NODAL / BATT / GEN as text tags — only the ones the site has. */
export function SiteTags({ s, className }: { s: SiteTagInfo; className?: string }) {
  const tags = siteTags({ ...s, powerSource: s.powerSource ?? null });
  if (!tags.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <Chip key={t} className={CHIP[t]} title={CHIP_TITLE[t]?.(s)}>
          {t}
        </Chip>
      ))}
    </span>
  );
}

/** ALM / CLR, then the site tags (`tags`), then the mail's other labels (`labels`). */
function Chips({
  a,
  cleared,
  tags,
  labels,
}: {
  a: MailAlarm;
  cleared: boolean;
  tags: boolean;
  labels: boolean;
}) {
  const chips = mailChips({
    cleared,
    office: a.office,
    labels: [...(a.rawMessage?.labels ?? []), ...(a.clearMessage?.labels ?? [])],
    vip: a.vip,
    nodality: a.nodality,
    battery: a.battery,
    powerSource: a.powerSource,
  }).filter((c) => (c.kind === "label" ? labels : tags));
  return (
    <>
      {chips.map((c) => (
        <Chip key={`${c.kind}:${c.label}`} className={CHIP[c.kind]} title={CHIP_TITLE[c.kind]?.(a)}>
          {c.label}
        </Chip>
      ))}
    </>
  );
}

/** "08:45 (7 min ago)" — date added when not today. */
function Arrival({ iso, now, timeZone }: { iso: string; now: number; timeZone: string }) {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const min = Math.max(0, Math.round((now - d.getTime()) / 60_000));
  const ago =
    min < 1
      ? "just now"
      : min < 60
        ? `${min} min ago`
        : min < 1440
          ? `${Math.floor(min / 60)} h ago`
          : `${Math.floor(min / 1440)} d ago`;
  return (
    <span className="tabular-nums" title={formatDateTime(iso, timeZone)}>
      {day(d) === day(new Date(now)) ? time : formatDateTime(iso, timeZone).slice(0, -3)}{" "}
      <span className="text-slate-400">({ago})</span>
    </span>
  );
}

/** Call button: one number dials at once; several open a list to pick from. */
function CallButton({ phone }: { phone: string }) {
  const numbers = phone.split(" / ").filter(Boolean);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const btn =
    "relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  if (numbers.length === 1)
    return (
      <a
        href={`tel:${numbers[0]}`}
        className={btn}
        title={`Call ${numbers[0]}`}
        aria-label={`Call ${numbers[0]}`}
      >
        <Phone className="h-4 w-4" />
      </a>
    );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={btn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${numbers.length} numbers`}
        aria-label={`Call — ${numbers.length} numbers`}
      >
        <Phone className="h-4 w-4" />
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-600">
          {numbers.length}
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {numbers.map((n) => (
            <a
              key={n}
              href={`tel:${n}`}
              dir="ltr"
              className="flex items-center gap-2 rounded-md px-3 py-2 font-mono text-sm text-slate-800 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              {n}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Subject rebuilt in the mail format ("… at |24-OCT-2026 09:51:54 |") when no mail is linked. */
function fallbackSubject(a: MailAlarm, timeZone: string, cleared: boolean) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(a.alarmTime))
      .map((x) => [x.type, x.value]),
  );
  const time = `${p.day}-${String(p.month).toUpperCase()}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
  return `${cleared ? "CLEARED_" : ""}${a.alarmName} on #${a.site}# at |${time} |`;
}

function MailRow({
  a,
  cleared,
  now,
  timeZone,
  age,
  alert,
  show,
}: {
  a: MailAlarm;
  cleared: boolean;
  now: number;
  timeZone: string;
  age: ReactNode;
  alert?: boolean;
  show: Record<MailPart, boolean>;
}) {
  const mail = cleared ? (a.clearMessage ?? a.rawMessage) : a.rawMessage;
  const subject =
    (cleared && a.clearMessage ? a.clearMessage.subject : a.rawMessage?.subject) ??
    fallbackSubject(a, timeZone, cleared);
  const cell = a.cellName ?? a.device;
  const times = show.received || show.raised;
  return (
    <li
      className={cn(
        "relative rounded-md border border-l-4 border-slate-200 bg-white p-3 shadow-sm sm:p-4",
        CATEGORY_STRIPE[a.category],
        alert && "bg-red-50/70",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-medium leading-snug text-slate-900 sm:text-base">
            {subject}
          </p>
          {(show.tags || show.labels) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
              <Chips a={a} cleared={cleared} tags={show.tags} labels={show.labels} />
            </div>
          )}
        </div>
        {(show.age || show.category) && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {show.age && age}
            {show.category && <CategoryBadge value={a.category} />}
          </div>
        )}
      </div>

      {((show.cellDevice && cell) || times || (show.phone && a.phone)) && (
        <div className="mt-2 flex items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1 text-xs text-slate-600">
            {show.cellDevice && cell && (
              <span className="flex min-w-0 items-center gap-1.5">
                {a.cellName ? (
                  <RadioTower className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : (
                  <Server className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span className="text-slate-500">{a.cellName ? "Cell" : "Device"}</span>
                <span className="break-all font-mono text-slate-800">{cell}</span>
              </span>
            )}
            {times && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {show.received && cleared && a.rawMessage && a.clearMessage && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="text-slate-500">Alarm mail</span>
                    <Arrival iso={a.rawMessage.receivedAt} now={now} timeZone={timeZone} />
                  </span>
                )}
                {show.received &&
                  (mail ? (
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="text-slate-500">
                        {cleared && a.clearMessage ? "Clear mail" : "Received"}
                      </span>
                      <Arrival iso={mail.receivedAt} now={now} timeZone={timeZone} />
                    </span>
                  ) : (
                    <span className="text-slate-400">Mail not linked</span>
                  ))}
                {show.raised && (
                  <span className="text-slate-500">
                    Raised{" "}
                    <span className="tabular-nums text-slate-700">
                      {formatDateTime(a.alarmTime, timeZone)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          {show.phone && a.phone && <CallButton phone={a.phone} />}
        </div>
      )}
    </li>
  );
}

export function AlarmMailList<T extends MailAlarm>({
  items,
  cleared = false,
  now,
  timeZone,
  loading,
  empty,
  age,
  alert,
}: {
  items: T[];
  cleared?: boolean;
  now: number;
  timeZone: string;
  loading?: boolean;
  empty: string;
  /** Top-right badge: age of an active alarm, duration of a cleared one. */
  age: (a: T) => ReactNode;
  alert?: (a: T) => boolean;
}) {
  const { prefs } = useUiPrefs();
  if (loading) return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
  if (!items.length) return <p className="py-10 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <MailRow
          key={a.id}
          a={a}
          cleared={cleared}
          now={now}
          timeZone={timeZone}
          age={age(a)}
          alert={alert?.(a)}
          show={prefs.alarms.mail}
        />
      ))}
    </ul>
  );
}

/** Table / Mail switch (Settings → Display alarms). */
export function ViewSwitch({
  value,
  onChange,
}: {
  value: "table" | "mail";
  onChange: (v: "table" | "mail") => void;
}) {
  return (
    <div
      className="flex rounded-md border border-slate-200 bg-white p-0.5 text-sm"
      role="group"
      aria-label="View"
    >
      {(["table", "mail"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "rounded px-3 py-1",
            value === v ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {v === "table" ? "Table" : "Mail"}
        </button>
      ))}
    </div>
  );
}

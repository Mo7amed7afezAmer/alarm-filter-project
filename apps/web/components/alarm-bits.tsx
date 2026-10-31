import type { ColumnDef } from "@tanstack/react-table";
import { BatteryMedium, Clock, MapPin, Network, Phone, RadioTower } from "lucide-react";
import type { ReactNode } from "react";
import { CATEGORY_STRIPE, splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SiteTags } from "./alarm-mail";
import { CategoryBadge } from "./badges";

/** Alarm name without the vendor prefix (shown as a small tag); full name on hover. */
export function AlarmName({ value, className }: { value: string; className?: string }) {
  const { prefix, name } = splitAlarmName(value);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={value}>
      <span className="truncate font-medium text-slate-900">{name}</span>
      {prefix && (
        <span className="shrink-0 rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-500">
          {prefix}
        </span>
      )}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-slate-600", className)}>{children}</span>;
}

/** Site Master fields the alarm APIs add (null = code not in Site Master). */
export interface SiteMasterInfo {
  siteCode: string | null;
  vip: boolean | null;
  nodality: string | null;
  battery: string | null;
  phone: string | null;
  powerSource?: string | null;
}

export function VipBadge() {
  return (
    <span className="shrink-0 rounded-sm bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      VIP
    </span>
  );
}

/** One tap to call from a phone; several numbers are separated by " / ". */
export function PhoneLink({ value, className }: { value: string | null; className?: string }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex flex-wrap gap-x-2", className)}>
      {value.split(" / ").map((n) => (
        <a
          key={n}
          href={`tel:${n}`}
          className="font-mono text-xs text-sky-700 hover:underline"
          dir="ltr"
        >
          {n}
        </a>
      ))}
    </span>
  );
}

/** VIP / NODAL / BATT / GEN as text tags (value on hover) — the "tags" display setting. */
export function SiteInfoIcons({ info }: { info: SiteMasterInfo }) {
  return <SiteTags s={info} />;
}

/** Site name + VIP badge, or + the VIP / NODAL / BATT / GEN tags when `icons` is on. */
export function SiteCell({
  site,
  vip,
  info,
  icons,
}: {
  site: string;
  vip: boolean | null;
  info?: SiteMasterInfo;
  icons?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Mono>{site}</Mono>
      {icons && info ? <SiteInfoIcons info={info} /> : vip && <VipBadge />}
    </span>
  );
}

const dash = <span className="text-slate-400">—</span>;

/** Nodality / Battery / Phone columns from Site Master (only Phone when shown as icons). */
export function siteMasterColumns<T extends SiteMasterInfo>(
  icons = false,
): ColumnDef<T, unknown>[] {
  const phone: ColumnDef<T, unknown> = {
    accessorKey: "phone",
    header: "Phone",
    cell: (c) => <PhoneLink value={c.getValue() as string | null} />,
  };
  if (icons) return [phone];
  return [
    {
      accessorKey: "nodality",
      header: "Nodality",
      cell: (c) => (c.getValue() as string | null) ?? dash,
    },
    {
      accessorKey: "battery",
      header: "Battery",
      cell: (c) => (c.getValue() as string | null) ?? dash,
    },
    phone,
  ];
}

/** Phone card for an alarm row. */
export function AlarmCard({
  alarmName,
  category,
  site,
  cell,
  meta,
  right,
  alert,
  info,
  icons,
}: {
  alarmName: string;
  category: string;
  site: string;
  cell?: string | null;
  meta: ReactNode;
  right?: ReactNode;
  alert?: boolean;
  info?: SiteMasterInfo;
  /** VIP / Nodality / Battery as icons next to the site. */
  icons?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-l-4 border-slate-200 bg-white p-3 shadow-sm",
        CATEGORY_STRIPE[category],
        alert && "bg-red-50/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <AlarmName value={alarmName} className="flex-wrap" />
        <CategoryBadge value={category} />
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <Mono className="break-all">{site}</Mono>
          {icons && info ? <SiteInfoIcons info={info} /> : info?.vip && <VipBadge />}
        </div>
        {info && ((!icons && (info.nodality || info.battery)) || info.phone) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!icons && info.nodality && (
              <span className="flex items-center gap-1">
                <Network className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {info.nodality}
              </span>
            )}
            {!icons && info.battery && (
              <span className="flex items-center gap-1">
                <BatteryMedium className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {info.battery}
              </span>
            )}
            {info.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <PhoneLink value={info.phone} />
              </span>
            )}
          </div>
        )}
        {cell && (
          <div className="flex items-center gap-1.5">
            <RadioTower className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <Mono className="break-all">{cell}</Mono>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {meta}
          </span>
          {right}
        </div>
      </div>
    </div>
  );
}

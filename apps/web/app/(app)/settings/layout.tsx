"use client";

import {
  Bell,
  Building2,
  Eye,
  FileSpreadsheet,
  Mail,
  Palette,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAppConfig, type AppConfig } from "@/components/app-config";
import { PageHeader } from "@/components/page-header";
import { useUiPrefs } from "@/components/ui-prefs";
import { cn } from "@/lib/utils";

type Role = AppConfig["role"];
const ADMINS: Role[] = ["ADMIN", "SUPER_ADMIN"];
const SUPER: Role[] = ["SUPER_ADMIN"];

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see the item; none = everyone. */
  roles?: Role[];
}

/** Settings sections: personal ones for every user, administration by role. */
const SETTINGS_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Personal",
    items: [
      { href: "/settings/general", label: "General", icon: Palette },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    title: "Alarms",
    items: [
      { href: "/settings/alarms/display", label: "Display alarms", icon: Eye },
      {
        href: "/settings/alarms/classification",
        label: "Classification",
        icon: Tags,
        roles: SUPER,
      },
    ],
  },
  {
    title: "Hourly reports",
    items: [{ href: "/settings/hourly", label: "Table, images & files", icon: FileSpreadsheet }],
  },
  {
    title: "Administration",
    items: [
      { href: "/settings/users", label: "Users & roles", icon: Users, roles: ADMINS },
      { href: "/settings/gmail", label: "Gmail connection", icon: Mail, roles: SUPER },
      {
        href: "/settings/site-master",
        label: "Value normalization",
        icon: Building2,
        roles: SUPER,
      },
    ],
  },
];

function SaveIndicator() {
  const { saveState } = useUiPrefs();
  if (saveState === "idle") return null;
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        saveState === "saving" && "bg-slate-100 text-slate-600",
        saveState === "saved" && "bg-emerald-50 text-emerald-700",
        saveState === "error" && "bg-red-50 text-red-700",
      )}
    >
      {saveState === "saving"
        ? "Saving…"
        : saveState === "saved"
          ? "Saved to your account"
          : "Could not save"}
    </span>
  );
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { role } = useAppConfig();
  const groups = SETTINGS_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length);

  const link = (i: Item, compact: boolean) => {
    const active = path === i.href || path.startsWith(i.href + "/");
    const Icon = i.icon;
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex shrink-0 items-center gap-2.5 rounded-lg text-sm transition-colors",
          compact ? "border px-3 py-1.5" : "px-3 py-2",
          active
            ? "border-brand bg-brand/15 font-medium text-slate-900"
            : "border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand" : "text-slate-400")} />
        {i.label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your personal settings are saved to your account and follow you on every device."
        actions={<SaveIndicator />}
      />
      {/* Phones: scrollable row of sections. */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden" aria-label="Settings">
        {groups.flatMap((g) => g.items).map((i) => link(i, true))}
      </nav>
      <div className="flex items-start gap-6">
        <nav
          className="sticky top-6 hidden w-56 shrink-0 space-y-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:block"
          aria-label="Settings"
        >
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {g.title}
              </div>
              <div className="space-y-0.5">{g.items.map((i) => link(i, false))}</div>
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-4">{children}</div>
      </div>
    </>
  );
}

"use client";

import {
  Bell,
  Building2,
  Eye,
  FileSpreadsheet,
  Mail,
  MessageCircle,
  Palette,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useAppConfig, type AppConfig } from "@/components/app-config";
import { PageHeader } from "@/components/page-header";
import { useUiPrefs } from "@/components/ui-prefs";
import { cn } from "@/lib/utils";

type Role = AppConfig["role"];
const ADMINS: Role[] = ["ADMIN", "SUPER_ADMIN"];
const SUPER: Role[] = ["SUPER_ADMIN"];
/** Everyone but viewers (each links their own WhatsApp number). */
const SENDERS: Role[] = ["OPERATOR", "ADMIN", "HOTLINE", "SUPER_ADMIN"];

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
      // each account links its own number (not a viewer)
      { href: "/settings/whatsapp", label: "WhatsApp sender", icon: MessageCircle, roles: SENDERS },
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
    items: [
      {
        href: "/settings/hourly",
        label: "Alarms, images & colours",
        icon: FileSpreadsheet,
        roles: ADMINS,
      },
    ],
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
  const nav = useRef<HTMLElement>(null);
  // narrow screens: keep the current tab in view
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>("[aria-current=page]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  const { role } = useAppConfig();
  const groups = SETTINGS_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your personal settings are saved to your account and follow you on every device."
        actions={<SaveIndicator />}
      />
      {/* Sections as tabs along the top (scrolls sideways when they do not fit); a thin
          divider separates the groups (Personal · Alarms · Hourly reports · Administration). */}
      <nav
        ref={nav}
        aria-label="Settings"
        className="-mx-4 flex items-end overflow-x-auto border-b border-slate-200 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {groups.map((g, gi) => (
          <div key={g.title} className="flex shrink-0 items-end" role="group" aria-label={g.title}>
            {gi > 0 && <span className="mx-1 mb-2.5 h-4 w-px bg-slate-200" aria-hidden />}
            {g.items.map((i) => {
              const active = path === i.href || path.startsWith(i.href + "/");
              const Icon = i.icon;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  title={`${g.title} · ${i.label}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-2.5 text-sm transition-colors",
                    active
                      ? "border-brand font-medium text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-900",
                  )}
                >
                  {/* icons only where all tabs fit with them */}
                  <Icon
                    className={cn(
                      "hidden h-4 w-4 shrink-0 2xl:block",
                      active ? "text-brand" : "text-slate-400",
                    )}
                  />
                  {i.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">{children}</div>
    </>
  );
}

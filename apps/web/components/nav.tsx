"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  BellRing,
  Building2,
  CircleCheck,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  RadioTower,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { isOfficeGroup, ROLE_LABEL } from "@alarm/core";
import { cn } from "@/lib/utils";
import { useAppConfig } from "./app-config";
import { useUiPrefs } from "./ui-prefs";
import { NotificationBell } from "./notification-bell";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/alarms", label: "Alarms", icon: BellRing },
  { href: "/cleared", label: "Cleared", icon: CircleCheck },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/hourly", label: "Hourly Alarms", icon: FileClock },
  { href: "/site-master", label: "Site Master", icon: Building2 },
  // Every user: personal settings (theme, alarm display, notifications); admins see more there.
  { href: "/settings", label: "Settings", icon: Settings },
];

/** md breakpoint: the sidebar is fixed on the left; below it a top bar opens it as a drawer. */
function useIsDesktop(): boolean | null {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

function Logo() {
  return (
    <Link href="/alarms" className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white">
        <RadioTower className="h-4 w-4" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-semibold text-white">Alarm Filter</span>
        <span className="block truncate text-[10px] uppercase tracking-wider text-sky-700">
          Network alarm monitor
        </span>
      </span>
    </Link>
  );
}

/** "DN/Kafr ElDawar" → group "DN" + name "Kafr ElDawar"; a whole group "DN" → "DN" + "All offices". */
function OfficePill({ office, isGroup }: { office: string; isGroup: boolean }) {
  const i = office.lastIndexOf("/");
  const group = isGroup ? office : i > 0 ? office.slice(0, i) : null;
  const name = isGroup ? "All offices" : i > 0 ? office.slice(i + 1) : office;
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-sm font-medium text-teal-800"
      title={`Office: ${office}`}
    >
      <Building2 className="h-4 w-4 shrink-0" />
      {group && <span className="text-teal-700">{group}</span>}
      <span className="truncate">{name}</span>
    </div>
  );
}

function SidebarContent({ bell }: { bell: boolean }) {
  const path = usePathname();
  const { role, email, office } = useAppConfig();
  const isActive = (href: string) => path.startsWith(href);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-3">
        <Logo />
        {bell && <NotificationBell />}
      </div>

      <div className="px-2 pt-2">
        <OfficePill
          office={office || (office === null ? "All offices" : "No office assigned")}
          isGroup={isOfficeGroup(office)}
        />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
              isActive(href) &&
                "bg-sidebar-primary font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sky-500",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold uppercase text-white">
          {email.charAt(0) || "?"}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-white" title={email}>
            {email}
          </div>
          <span className="mt-1 inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-sky-800">
            {ROLE_LABEL[role]}
          </span>
        </div>
        <button
          className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
          title="Sign out"
          aria-label="Sign out"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Nav() {
  const path = usePathname();
  // The sidebar stays dark in the light theme (the variables are re-set on these elements).
  const { theme } = useUiPrefs().prefs;
  const barTheme = theme === "light" ? "blue" : undefined;
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]); // close the drawer after navigating

  return (
    <>
      {/* Desktop: fixed sidebar. Only one NotificationBell is mounted (it polls and beeps). */}
      <aside
        data-theme={barTheme}
        className="fixed inset-y-0 left-0 z-30 hidden w-52 border-r border-sidebar-border bg-sidebar md:block"
      >
        <SidebarContent bell={desktop === true} />
      </aside>

      {/* Phone / tablet: top bar + drawer. */}
      <header
        data-theme={barTheme}
        className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar px-4 md:hidden"
      >
        <Logo />
        <div className="flex items-center gap-1">
          {desktop === false && <NotificationBell />}
          <button
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>
      {open && (
        <div data-theme={barTheme} className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar shadow-xl">
            <SidebarContent bell={false} />
          </aside>
        </div>
      )}
    </>
  );
}

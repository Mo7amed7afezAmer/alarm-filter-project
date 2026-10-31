"use client";

// Sends a role away from a page it may not open (lib/pages.ts) — e.g. a hotline account that
// types /hourly — instead of showing it.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAppConfig } from "@/components/app-config";
import { canSeePage } from "@/lib/pages";

export function PageGate({ children }: { children: ReactNode }) {
  const { role } = useAppConfig();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = canSeePage(role, pathname);
  useEffect(() => {
    if (!allowed) router.replace("/alarms");
  }, [allowed, router]);
  return allowed ? <>{children}</> : null;
}

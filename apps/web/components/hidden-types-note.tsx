"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyeOff } from "lucide-react";
import { useState } from "react";
import { useAppConfig } from "./app-config";
import { Notice } from "./ui/notice";

const PAGES = ["/alarms", "/cleared", "/dashboard"];

const plural = (n: number) => `${n} alarm type${n > 1 ? "s" : ""}`;

/** Tells the user that some alarm types are hidden (by the admin and/or by themselves). The ×
 *  closes it until the page is reloaded (not remembered — the note comes back on refresh). */
export function HiddenTypesNote() {
  const path = usePathname();
  const { hiddenTypes, myHiddenTypes, role } = useAppConfig();
  // kept here (the layout stays mounted), so it stays closed while moving between the pages
  const [closed, setClosed] = useState(false);
  if (closed || (!hiddenTypes && !myHiddenTypes) || !PAGES.some((p) => path.startsWith(p)))
    return null;
  return (
    <Notice
      icon={<EyeOff />}
      onClose={() => setClosed(true)}
      className="text-xs"
      contentClassName="flex flex-wrap gap-x-3 gap-y-1"
    >
      {hiddenTypes > 0 && (
        <span>
          {plural(hiddenTypes)} hidden for everyone
          {role === "SUPER_ADMIN" && (
            <>
              {" · "}
              <Link href="/settings/alarms/display" className="font-medium underline">
                Settings
              </Link>
            </>
          )}
        </span>
      )}
      {myHiddenTypes > 0 && (
        <span>
          {plural(myHiddenTypes)} hidden by you ·{" "}
          <Link href="/settings/alarms/display" className="font-medium underline">
            Change
          </Link>
        </span>
      )}
    </Notice>
  );
}

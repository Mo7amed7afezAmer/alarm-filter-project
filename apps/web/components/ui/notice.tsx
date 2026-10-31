"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONE = {
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700",
} as const;

/**
 * A message box with an × that closes it. Closing is not remembered: the box comes back after a
 * refresh. With `onClose` the caller clears its own message (so a new message shows again);
 * without it the box hides itself.
 */
export function Notice({
  tone = "warning",
  icon,
  onClose,
  className,
  contentClassName,
  children,
}: {
  tone?: keyof typeof TONE;
  icon?: ReactNode;
  onClose?: () => void;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        TONE[tone],
        className,
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <div className={cn("min-w-0 flex-1", contentClassName)}>{children}</div>
      <button
        type="button"
        onClick={() => (onClose ? onClose() : setClosed(true))}
        className="-mr-1 shrink-0 rounded-sm p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100"
        title="Close"
        aria-label="Close this message"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** Small copy icon; turns into a tick for a moment after copying. `children` = optional label. */
export function CopyButton({
  text,
  label,
  className,
  children,
}: {
  text: string;
  /** What is copied, for the tooltip / screen readers ("Copy code"). */
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const copy = async () => {
    try {
      await copyText(text);
      setState("done");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={state === "done" ? "Copied" : state === "error" ? "Could not copy" : label}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700",
        state === "done" && "text-emerald-600",
        state === "error" && "text-red-600",
        className,
      )}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

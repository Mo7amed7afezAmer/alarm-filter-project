"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One item of a gap accordion (settings pages: the items sit apart, with a gap): a header button with the title, a
 * short summary of the current setting and a chevron; `action` sits on the right of the header
 * (outside the button). Several items can be open at once.
 */
export function AccordionSection({
  title,
  summary,
  description,
  action,
  defaultOpen = false,
  contentClassName,
  children,
}: {
  title: string;
  summary?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-180 text-brand",
            )}
          />
          <span className="text-base font-semibold text-slate-900">{title}</span>
          {summary && <span className="min-w-0 truncate text-sm text-slate-500">{summary}</span>}
        </button>
        {action}
      </div>
      {open && (
        <div id={id} className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
          {description && <p className="text-sm text-slate-500">{description}</p>}
          <div className={contentClassName}>{children}</div>
        </div>
      )}
    </section>
  );
}

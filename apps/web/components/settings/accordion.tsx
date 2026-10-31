"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const Group = createContext<{
  open: string | null;
  setOpen: (title: string | null) => void;
} | null>(null);

/** Sections inside an AccordionGroup open one at a time: opening one closes the others. */
export function AccordionGroup({
  defaultOpen = null,
  children,
}: {
  /** Title of the section open at first. */
  defaultOpen?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <Group.Provider value={{ open, setOpen }}>{children}</Group.Provider>;
}

/**
 * One item of a gap accordion (settings pages: the items sit apart, with a gap): a header button with the title, a
 * short summary of the current setting and a chevron; `action` sits on the right of the header
 * (outside the button). Several items can be open at once — one at a time inside an
 * AccordionGroup (sections are told apart by title).
 */
export function AccordionSection({
  title,
  icon,
  badge,
  summary,
  description,
  action,
  defaultOpen = false,
  contentClassName,
  children,
}: {
  title: string;
  /** Small icon before the title. */
  icon?: ReactNode;
  /** Short pill after the title, e.g. "In use". */
  badge?: ReactNode;
  summary?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const group = useContext(Group);
  const open = group ? group.open === title : own;
  const toggle = () => (group ? group.setOpen(open ? null : title) : setOwn(!open));
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-180 text-brand",
            )}
          />
          {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
          <span className="shrink-0 text-base font-semibold text-slate-900">{title}</span>
          {badge}
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

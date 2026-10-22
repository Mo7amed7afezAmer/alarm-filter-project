import type { ReactNode } from "react";

/** Title of one /settings section (the page title "Settings" is in the layout). */
export function SectionHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function NoAccess({ who = "the super admin" }: { who?: string }) {
  return <p className="text-sm text-slate-500">This section is available to {who} only.</p>;
}

/** On/off switch with a label and an optional hint. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-brand" : "bg-slate-300")
        }
      >
        <span
          className={
            "absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform " +
            (checked ? "translate-x-[1.375rem]" : "translate-x-0.5")
          }
        />
      </button>
    </label>
  );
}

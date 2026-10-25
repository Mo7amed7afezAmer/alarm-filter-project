"use client";

// Settings → General: the theme (everyone) and, for the super admin, the office being viewed and
// reprocessing (user request 2026-10-25: one page instead of three).
import { Check } from "lucide-react";
import type { Theme } from "@alarm/core";
import { useAppConfig } from "@/components/app-config";
import { OfficePicker, Reprocess } from "@/components/settings/admin";
import { SectionHeader } from "@/components/settings/section";
import { useUiPrefs } from "@/components/ui-prefs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const THEME_INFO: { value: Theme; label: string; hint: string }[] = [
  { value: "blue", label: "Blue", hint: "Dark navy (default)" },
  { value: "dark", label: "Dark", hint: "Neutral charcoal" },
  { value: "light", label: "Light", hint: "White pages, dark sidebar" },
];

/** A small page mock-up drawn with the theme's own colours (data-theme on the preview). */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <div
      data-theme={theme}
      className="flex h-24 overflow-hidden rounded-lg border border-slate-200 bg-background"
    >
      <div
        data-theme={theme === "light" ? "blue" : theme}
        className="w-1/4 space-y-1.5 bg-sidebar p-2"
      >
        <div className="h-2 w-3/4 rounded bg-brand" />
        <div className="h-1.5 w-full rounded bg-sidebar-accent" />
        <div className="h-1.5 w-full rounded bg-sidebar-primary" />
        <div className="h-1.5 w-2/3 rounded bg-sidebar-accent" />
      </div>
      <div className="flex-1 space-y-1.5 p-2">
        <div className="h-2 w-1/3 rounded bg-slate-900/80" />
        <div className="space-y-1 rounded-md border border-slate-200 bg-white p-1.5">
          <div className="flex gap-1">
            <span className="h-1.5 w-6 rounded bg-red-100" />
            <span className="h-1.5 flex-1 rounded bg-slate-200" />
          </div>
          <div className="flex gap-1">
            <span className="h-1.5 w-6 rounded bg-amber-100" />
            <span className="h-1.5 flex-1 rounded bg-slate-200" />
          </div>
          <div className="flex gap-1">
            <span className="h-1.5 w-6 rounded bg-emerald-100" />
            <span className="h-1.5 flex-1 rounded bg-slate-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GeneralSettings() {
  const { role } = useAppConfig();
  const { prefs, update } = useUiPrefs();
  const superAdmin = role === "SUPER_ADMIN";
  return (
    <>
      <SectionHeader
        title="General"
        subtitle={
          superAdmin
            ? "Theme, the office you are looking at, and reprocessing."
            : "How the site looks for you."
        }
      />
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <p className="text-sm text-slate-500">Applies at once on every page.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {THEME_INFO.map((t) => {
            const on = prefs.theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => update((p) => ({ ...p, theme: t.value }))}
                className={cn(
                  "space-y-2 rounded-xl border p-2.5 text-left transition-colors",
                  on ? "border-brand ring-1 ring-brand" : "border-slate-200 hover:bg-slate-100",
                )}
              >
                <ThemePreview theme={t.value} />
                <div className="flex items-center justify-between px-0.5">
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t.label}</span>
                    <span className="block text-xs text-slate-500">{t.hint}</span>
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border",
                      on ? "border-brand bg-brand text-white" : "border-slate-300",
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>
      {superAdmin && (
        <>
          <OfficePicker />
          <Reprocess />
        </>
      )}
    </>
  );
}

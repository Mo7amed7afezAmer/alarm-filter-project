"use client";

// Hourly report settings shared per office (hourly_settings, Settings → Alarms, images &
// colours): read by every hourly page; changed only by an office admin (their office) or the
// super admin (the viewed office, or the default) — saved via PUT /api/hourly-settings.
import { normalizeHourlyPrefs, type HourlyPrefs } from "@alarm/core";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { SaveState } from "./ui-prefs";

export interface HourlySettingsMeta {
  /** Row the settings came from: an office label, "*" (default) or null (built-in). */
  source: string | null;
  /** Row a save writes; null = read-only for this user. */
  editKey: string | null;
}

interface HourlyPrefsCtx {
  hp: HourlyPrefs;
  meta: HourlySettingsMeta;
  canEdit: boolean;
  /** The edited office has its own settings (else it uses the default). */
  own: boolean;
  /** Applied at once, saved shortly after (admins only; no-op for others). */
  update: (fn: (p: HourlyPrefs) => HourlyPrefs) => void;
  /** The edited office goes back to the default settings. */
  reset: () => Promise<void>;
  saveState: SaveState;
}

const Ctx = createContext<HourlyPrefsCtx | null>(null);

export function HourlyPrefsProvider({
  initial,
  initialMeta,
  children,
}: {
  initial: HourlyPrefs;
  initialMeta: HourlySettingsMeta;
  children: ReactNode;
}) {
  const [hp, setHp] = useState(initial);
  const [meta, setMeta] = useState(initialMeta);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const canEdit = !!meta.editKey;

  const update = useCallback(
    (fn: (p: HourlyPrefs) => HourlyPrefs) => {
      if (!canEdit) return;
      setHp((old) => {
        const next = normalizeHourlyPrefs(fn(old));
        clearTimeout(timer.current);
        setSaveState("saving");
        // Debounced: several clicks in a row are one request.
        timer.current = setTimeout(async () => {
          try {
            const res = await fetch("/api/hourly-settings", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (!res.ok) throw new Error(String(res.status));
            const body = (await res.json()) as { meta: HourlySettingsMeta };
            setMeta(body.meta);
            setSaveState("saved");
          } catch {
            setSaveState("error");
          }
        }, 400);
        return next;
      });
    },
    [canEdit],
  );

  const reset = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/hourly-settings", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: HourlyPrefs; meta: HourlySettingsMeta };
      setHp(normalizeHourlyPrefs(body.data));
      setMeta(body.meta);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const own = canEdit && meta.source === meta.editKey;
  return (
    <Ctx.Provider value={{ hp, meta, canEdit, own, update, reset, saveState }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHourlyPrefs(): HourlyPrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHourlyPrefs outside HourlyPrefsProvider");
  return v;
}

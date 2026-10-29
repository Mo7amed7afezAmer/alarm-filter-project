"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { normalizeUiPrefs, type UiPrefs } from "@alarm/core";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface UiPrefsCtx {
  prefs: UiPrefs;
  /** Change the user's settings: applied at once, saved to the account shortly after. */
  update: (fn: (p: UiPrefs) => UiPrefs) => void;
  saveState: SaveState;
}

const Ctx = createContext<UiPrefsCtx | null>(null);

/** Personal UI settings (users.uiPrefs) of the signed-in user, saved via PUT /api/me/ui-prefs. */
export function UiPrefsProvider({ initial, children }: { initial: UiPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const update = useCallback((fn: (p: UiPrefs) => UiPrefs) => {
    setPrefs((old) => {
      const next = normalizeUiPrefs(fn(old));
      document.documentElement.dataset.theme = next.theme;
      if (next.borders) delete document.documentElement.dataset.borders;
      else document.documentElement.dataset.borders = "off";
      clearTimeout(timer.current);
      setSaveState("saving");
      // Debounced: several clicks in a row (column checkboxes) are one request.
      timer.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/me/ui-prefs", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          setSaveState(res.ok ? "saved" : "error");
        } catch {
          setSaveState("error");
        }
      }, 400);
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ prefs, update, saveState }}>{children}</Ctx.Provider>;
}

export function useUiPrefs(): UiPrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUiPrefs outside UiPrefsProvider");
  return v;
}

"use client";

import { Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CategoryBadge } from "@/components/badges";
import { SectionHeader, Toggle } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/components/use-poll";
import { splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = "DOWN" | "POWER" | "OTHER";
interface Prefs {
  enabled: boolean;
  sound: boolean;
  categories: Category[];
  alarmNames: string[];
  sites: string[];
}
interface AlarmName {
  name: string;
  category: Category;
  count: number;
}

const CATEGORY_INFO: { value: Category; label: string; hint: string }[] = [
  { value: "DOWN", label: "Down", hint: "Link failures, cells/sites out of service" },
  { value: "POWER", label: "Power", hint: "Mains, rectifier, battery, generator" },
  { value: "OTHER", label: "Other", hint: "Everything else (doors, fire, temperature…)" },
];

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>;
}

export default function NotificationSettings() {
  const { data } = usePoll<{ prefs: Prefs }>("/api/me/notification-prefs", 0);
  const names = usePoll<{ names: AlarmName[] }>("/api/alarm-names", 0);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [nameQuery, setNameQuery] = useState("");
  const [siteInput, setSiteInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !prefs) setPrefs(data.prefs);
  }, [data, prefs]);

  const filteredNames = useMemo(() => {
    const q = nameQuery.trim().toUpperCase();
    const list = names.data?.names ?? [];
    // Selected names first, then the rest by frequency.
    const selected = new Set(prefs?.alarmNames.map((n) => n.toUpperCase()));
    return [...list]
      .filter((n) => !q || n.name.toUpperCase().includes(q))
      .sort(
        (a, b) =>
          Number(selected.has(b.name.toUpperCase())) - Number(selected.has(a.name.toUpperCase())),
      );
  }, [names.data, nameQuery, prefs?.alarmNames]);

  if (!prefs) {
    return (
      <>
        <SectionHeader title="Notifications" />
        <p className="text-sm text-slate-500">Loading…</p>
      </>
    );
  }

  const set = (patch: Partial<Prefs>) => {
    setPrefs({ ...prefs, ...patch });
    setMsg(null);
  };
  const toggleIn = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const addSite = () => {
    const v = siteInput.trim();
    if (v && !prefs.sites.some((s) => s.toUpperCase() === v.toUpperCase()))
      set({ sites: [...prefs.sites, v] });
    setSiteInput("");
  };

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/me/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setPrefs(json.prefs);
      setMsg({ ok: true, text: "Saved — the bell uses these settings from now on." });
    } catch (e) {
      setMsg({ ok: false, text: `Error: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const summary = !prefs.enabled
    ? "Notifications are off."
    : [
        prefs.categories.length ? prefs.categories.join(" / ") : "any category",
        prefs.alarmNames.length
          ? `${prefs.alarmNames.length} selected alarm name(s)`
          : "any alarm name",
        prefs.sites.length
          ? `sites containing ${prefs.sites.map((s) => `"${s}"`).join(" or ")}`
          : "any site",
      ].join(" · ");

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          title="Notifications"
          subtitle="Choose which NEW alarms are important to you (your account only)."
        />
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save notifications"}
        </Button>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <span className="font-medium">You will be notified about: </span>
        {summary}
      </div>
      {msg && (
        <Notice tone={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle
                label="Notifications"
                hint="Bell counter, pop-up card and tab title when an important alarm arrives"
                checked={prefs.enabled}
                onChange={(v) => set({ enabled: v })}
              />
              <Toggle
                label="Sound"
                hint="Short beep for new alarms (the page must be open; click it once after loading)"
                checked={prefs.sound}
                onChange={(v) => set({ sound: v })}
              />
            </CardContent>
          </Card>

          <Card
            className={cn("rounded-xl border-slate-200 shadow-sm", !prefs.enabled && "opacity-60")}
          >
            <CardHeader>
              <CardTitle className="text-base">Categories</CardTitle>
              <Hint>None selected = all categories.</Hint>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {CATEGORY_INFO.map((c) => {
                const on = prefs.categories.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => set({ categories: toggleIn(prefs.categories, c.value) })}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      on
                        ? "border-brand bg-brand/10 ring-1 ring-brand"
                        : "border-slate-200 hover:bg-slate-100/70",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <CategoryBadge value={c.value} />
                      <span
                        className={cn(
                          "h-4 w-4 rounded border",
                          on ? "border-brand bg-brand" : "border-slate-300",
                        )}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{c.hint}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card
            className={cn("rounded-xl border-slate-200 shadow-sm", !prefs.enabled && "opacity-60")}
          >
            <CardHeader>
              <CardTitle className="text-base">Sites</CardTitle>
              <Hint>Part of the site name, e.g. “KAFR” or “MHLT-KYL”. None = all sites.</Hint>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={siteInput}
                  placeholder="e.g. KANAYES"
                  className="bg-white"
                  onChange={(e) => setSiteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSite();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addSite}
                  disabled={!siteInput.trim()}
                >
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {prefs.sites.map((s) => (
                  <span
                    key={s}
                    className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 font-mono text-xs text-slate-700"
                  >
                    {s}
                    <button
                      aria-label={`Remove ${s}`}
                      className="rounded-full p-0.5 hover:bg-slate-200"
                      onClick={() => set({ sites: prefs.sites.filter((x) => x !== s) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {!prefs.sites.length && <span className="text-xs text-slate-400">All sites</span>}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card
          className={cn("rounded-xl border-slate-200 shadow-sm", !prefs.enabled && "opacity-60")}
        >
          <CardHeader>
            <CardTitle className="text-base">Alarm names</CardTitle>
            <Hint>
              Pick specific alarms (from the last 30 days in this office). None selected = all
              names.
              {prefs.alarmNames.length > 0 && (
                <>
                  {" "}
                  <button
                    className="text-sky-700 underline"
                    onClick={() => set({ alarmNames: [] })}
                  >
                    Clear {prefs.alarmNames.length} selected
                  </button>
                </>
              )}
            </Hint>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Search alarm names"
                className="bg-white pl-8"
              />
            </div>
            <div className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {filteredNames.map((n) => {
                const on = prefs.alarmNames.some((x) => x.toUpperCase() === n.name.toUpperCase());
                const { name, prefix } = splitAlarmName(n.name);
                return (
                  <label
                    key={n.name}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-100/70",
                      on && "bg-slate-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={on}
                      onChange={() =>
                        set({
                          alarmNames: on
                            ? prefs.alarmNames.filter(
                                (x) => x.toUpperCase() !== n.name.toUpperCase(),
                              )
                            : [...prefs.alarmNames, n.name],
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900" title={n.name}>
                        {name}
                        {prefix && (
                          <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                            {prefix}
                          </span>
                        )}
                      </span>
                    </span>
                    <CategoryBadge value={n.category} />
                    <span className="w-10 text-right text-xs tabular-nums text-slate-400">
                      {n.count}
                    </span>
                  </label>
                );
              })}
              {names.data && !filteredNames.length && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  No alarm names match.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

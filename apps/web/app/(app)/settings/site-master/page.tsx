"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { api } from "@/components/hourly/client";
import { SectionHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Rule {
  field: string;
  from: string;
  to: string;
}

function NormalizationsCard() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: Rule[]; meta: { fields: string[] } }>("/api/hourly-normalizations")
      .then((r) => {
        setRules(r.data.map(({ field, from, to }) => ({ field, from, to })));
        setFields(r.meta.fields);
      })
      .catch((e) => setMsg(`Error: ${(e as Error).message}`));
  }, []);
  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    try {
      const r = await api<{ data: Rule[] }>("/api/hourly-normalizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules!.filter((x) => x.from.trim())),
      });
      setRules(r.data.map(({ field, from, to }) => ({ field, from, to })));
      setMsg("Saved — reports are re-processed with the new rules");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  };
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Value normalization</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every value is trimmed, double spaces collapsed and upper-cased first; then these fixes
          replace whole words (e.g. SHELTER DOO → SHELTER DOOR). Field <b>*</b> applies everywhere;
          alarmName rules also fix Alarm Text and Supplementary Information.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules?.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border bg-white px-2 text-sm"
              value={r.field}
              onChange={(e) => update(i, { field: e.target.value })}
            >
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <Input
              className="h-8 w-56 bg-white"
              value={r.from}
              placeholder="from"
              onChange={(e) => update(i, { from: e.target.value })}
            />
            <span className="text-slate-400">→</span>
            <Input
              className="h-8 w-56 bg-white"
              value={r.to}
              placeholder="to"
              onChange={(e) => update(i, { to: e.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove rule"
              onClick={() => setRules((rs) => rs!.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={() =>
              setRules((rs) => [...(rs ?? []), { field: "alarmName", from: "", to: "" }])
            }
          >
            <Plus className="h-4 w-4" /> Add rule
          </Button>
          <Button size="sm" disabled={!rules} onClick={() => void save()}>
            Save rules
          </Button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function SiteMasterView() {
  const { role } = useAppConfig();
  if (role !== "SUPER_ADMIN")
    return (
      <p className="text-sm text-slate-600">Value normalization is managed by the super admin.</p>
    );
  return (
    <>
      <SectionHeader
        title="Value normalization"
        subtitle={
          <>
            Fixes applied to hourly report values. The sites themselves are on the{" "}
            <Link href="/site-master" className="text-sky-700 underline">
              Site Master
            </Link>{" "}
            page.
          </>
        }
      />
      <NormalizationsCard />
    </>
  );
}

export default function SiteMasterPage() {
  return (
    <Suspense>
      <SiteMasterView />
    </Suspense>
  );
}

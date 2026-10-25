"use client";

// Site Master: every site of the user's office scope, with filters and paging. The list shows only
// code, name, office and flags; "Details" opens a window with every field and the Copy / WhatsApp
// buttons, plus Edit / Delete for admins (office admins: their own office only). Admins also add a
// site in a window or import an Excel file.
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Plus, Upload } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { CopyButton } from "@/components/copy-button";
import { DataTable, Pager } from "@/components/data-table";
import { Field, FilterBar, TextFilter, useUrlFilters } from "@/components/filters";
import { api } from "@/components/hourly/client";
import { PageHeader } from "@/components/page-header";
import {
  ImportDialog,
  OfficeName,
  SiteChips,
  SiteDetailsDialog,
  SiteDialog,
  type Site,
} from "@/components/site-master/dialogs";
import { Button } from "@/components/ui/button";
import { usePoll } from "@/components/use-poll";

interface SitesPage {
  data: Site[];
  meta: {
    total: number;
    page: number;
    pages: number;
    offices: { office: string; count: number }[];
    siteTypes: string[];
    canManage: boolean;
  };
}

const dash = <span className="text-slate-400">—</span>;
const select = "h-9 w-full rounded-md border border-input bg-white px-2 text-sm sm:w-36";

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <Field label={label}>
      <select className={select} value={value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  );
}

function DetailsButton({ s, onClick }: { s: Site; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 bg-white"
      onClick={onClick}
      aria-label={`Details of ${s.code}`}
    >
      <Eye className="h-4 w-4" />
      Details
    </Button>
  );
}

function SiteMasterView() {
  const { role } = useAppConfig();
  const { params, set } = useUrlFilters();
  const f = (k: string) => params.get(k) ?? "";
  const page = Number(params.get("page") ?? 1);
  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const k of ["q", "office", "vip", "nodal", "generator", "battery", "siteType"])
    if (f(k)) query.set(k, f(k));

  const [reloadKey, setReloadKey] = useState(0);
  const { data, error, loading, reload } = usePoll<SitesPage>(
    `/api/site-master?${query}&k=${reloadKey}`,
    0,
  );
  const [viewing, setViewing] = useState<Site | null>(null);
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = !!data?.meta.canManage;
  const offices = data?.meta.offices.map((o) => o.office) ?? [];
  // Office admins add sites to their own office only.
  const lockOffice = role === "ADMIN" ? (offices[0] ?? null) : null;

  const remove = async (s: Site) => {
    if (
      !window.confirm(
        `Delete site ${s.code}${s.siteName ? ` (${s.siteName})` : ""}? This cannot be undone.`,
      )
    )
      return;
    try {
      await api(`/api/site-master/${encodeURIComponent(s.code)}`, { method: "DELETE" });
      setMsg(`Deleted ${s.code}`);
      setViewing(null);
      await reload();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  };

  const columns = useMemo<ColumnDef<Site, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: (c) => (
          <span className="inline-flex items-center gap-0.5">
            <span className="font-mono text-xs font-semibold text-slate-900">
              {c.row.original.code}
            </span>
            <CopyButton text={c.row.original.code} label="Copy code" />
          </span>
        ),
      },
      {
        accessorKey: "siteName",
        header: "Site name",
        cell: (c) => (c.getValue() as string | null) ?? dash,
      },
      {
        accessorKey: "office",
        header: "Office",
        cell: (c) => <OfficeName office={c.row.original.office} />,
      },
      { id: "flags", header: "Flags", cell: (c) => <SiteChips s={c.row.original} nowrap /> },
      {
        id: "details",
        header: "",
        cell: (c) => (
          <DetailsButton s={c.row.original} onClick={() => setViewing(c.row.original)} />
        ),
      },
    ],
    [],
  );

  const active = ["q", "office", "vip", "nodal", "generator", "battery", "siteType"].filter((k) =>
    f(k),
  ).length;

  return (
    <>
      <PageHeader
        title="Site Master"
        count={data?.meta.total}
        subtitle="Site details joined to alarms and hourly reports"
        actions={
          canManage && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="bg-white"
                onClick={() => setImporting(true)}
              >
                <Upload className="h-4 w-4" />
                Import Excel
              </Button>
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" />
                Add site
              </Button>
            </>
          )
        }
      />

      <FilterBar active={active}>
        <TextFilter
          label="Search"
          value={f("q")}
          placeholder="Code, name, phone, location"
          onChange={(v) => set({ q: v })}
        />
        {offices.length > 1 && (
          <Field label="Office">
            <select
              className={select}
              value={f("office")}
              onChange={(e) => set({ office: e.target.value || null })}
            >
              <option value="">All offices</option>
              {data?.meta.offices.map((o) => (
                <option key={o.office} value={o.office}>
                  {o.office} ({o.count})
                </option>
              ))}
            </select>
          </Field>
        )}
        <YesNo label="VIP" value={f("vip")} onChange={(v) => set({ vip: v })} />
        <YesNo label="Nodal" value={f("nodal")} onChange={(v) => set({ nodal: v })} />
        <YesNo label="Generator" value={f("generator")} onChange={(v) => set({ generator: v })} />
        <YesNo label="Batteries" value={f("battery")} onChange={(v) => set({ battery: v })} />
        {!!data?.meta.siteTypes.length && (
          <Field label="Site type">
            <select
              className={select}
              value={f("siteType")}
              onChange={(e) => set({ siteType: e.target.value || null })}
            >
              <option value="">Any</option>
              {data.meta.siteTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        )}
      </FilterBar>

      {msg && <p className="text-sm text-slate-500">{msg}</p>}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load: {error}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        getRowId={(s) => s.code}
        loading={loading && !data}
        empty={canManage ? "No sites — add one or import an Excel file" : "No sites"}
        renderCard={(s) => (
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-0.5">
                  <span className="font-mono text-sm font-semibold text-slate-900">{s.code}</span>
                  <CopyButton text={s.code} label="Copy code" />
                </div>
                <p className="truncate text-sm text-slate-700">{s.siteName ?? "—"}</p>
                <p className="text-xs text-slate-500">{s.office}</p>
              </div>
              <SiteChips s={s} />
            </div>
            <div className="mt-2 flex justify-end border-t border-slate-100 pt-2">
              <DetailsButton s={s} onClick={() => setViewing(s)} />
            </div>
          </div>
        )}
      />
      {data && (
        <Pager
          page={data.meta.page}
          pages={data.meta.pages}
          total={data.meta.total}
          onPage={(p) => set({ page: String(p) })}
        />
      )}

      {viewing && (
        <SiteDetailsDialog
          site={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onDelete={() => void remove(viewing)}
        />
      )}
      {editing && (
        <SiteDialog
          site={editing === "new" ? null : editing}
          offices={offices}
          siteTypes={data?.meta.siteTypes ?? []}
          lockOffice={role !== "ADMIN" ? null : editing === "new" ? lockOffice : editing.office}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setMsg(`${editing === "new" ? "Added" : "Saved"} ${s.code}`);
            // An edit goes back to the site's details window, now with the saved values.
            if (editing !== "new") setViewing(s);
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={() => setReloadKey((k) => k + 1)}
        />
      )}
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

"use client";

// Site Master page windows: one site's details (edit / delete / WhatsApp / copy), add / edit one
// site, and import an Excel file.
import { mapsUrl, officeColor, siteWhatsAppText } from "@alarm/core";
import { Download, MapPin, MessageCircle, Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { PhoneLink } from "@/components/alarm-bits";
import { SiteTags } from "@/components/alarm-mail";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/components/hourly/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";

export interface Site {
  code: string;
  siteName: string | null;
  office: string;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  phone: string | null;
  location: string | null;
  region: string | null;
  notes: string | null;
  updatedAt: string;
}

const dash = <span className="text-slate-400">—</span>;

/** VIP / NODAL / BATT / GEN text tags — the same tags as the alarm Mail view. */
export function SiteChips({ s, nowrap }: { s: Site; nowrap?: boolean }) {
  return <SiteTags s={s} className={nowrap ? "flex-nowrap" : undefined} />;
}

/** Office name with its colour dot. */
export function OfficeName({ office }: { office: string }) {
  const color = officeColor(office);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {color && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `#${color}` }} />
      )}
      {office}
    </span>
  );
}

function Location({ value }: { value: string | null }) {
  if (!value) return dash;
  const url = mapsUrl(value);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline"
          title="Open in Google Maps"
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{/^https?:/i.test(value) ? "Map link" : value}</span>
        </a>
      ) : (
        <span className="break-words">{value}</span>
      )}
      <CopyButton text={value} label="Copy location" />
    </span>
  );
}

/** Every field of one site, with Copy / WhatsApp for everyone and Edit / Delete for managers. */
export function SiteDetailsDialog({
  site: s,
  canManage,
  onClose,
  onEdit,
  onDelete,
}: {
  site: Site;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const message = siteWhatsAppText(s);
  const text = (v: string | null) => v ?? dash;
  const rows: [string, ReactNode][] = [
    ["Office", <OfficeName key="o" office={s.office} />],
    ["Nodality", text(s.nodality)],
    ["Site type", text(s.siteType)],
    ["Power source", text(s.powerSource)],
    ["Battery", text(s.battery)],
    ["Guard phone", <PhoneLink key="p" value={s.phone} />],
    ["Location", <Location key="l" value={s.location} />],
    ["Region", text(s.region)],
    ["Notes", s.notes ? <span className="whitespace-pre-wrap">{s.notes}</span> : dash],
    ["Updated", new Date(s.updatedAt).toLocaleString()],
  ];
  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-1">
          <span className="font-mono">{s.code}</span>
          <CopyButton text={s.code} label="Copy code" />
        </span>
      }
      onClose={onClose}
      footer={
        <>
          {canManage && (
            <>
              <Button
                variant="outline"
                className="mr-auto border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <Button variant="outline" className="bg-white" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </>
          )}
          <CopyButton
            text={message}
            label="Copy site details as a WhatsApp message"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Copy
          </CopyButton>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="text-base font-medium text-slate-900">{s.siteName ?? "—"}</p>
          <div className="mt-1">
            <SiteChips s={s} />
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="min-w-0 text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

type Form = Record<
  | "code"
  | "siteName"
  | "office"
  | "nodality"
  | "siteType"
  | "powerSource"
  | "battery"
  | "phone"
  | "location"
  | "notes",
  string
> & { vip: boolean };

const toForm = (s: Partial<Site>): Form => ({
  code: s.code ?? "",
  siteName: s.siteName ?? "",
  office: s.office ?? "",
  nodality: s.nodality ?? "",
  vip: s.vip ?? false,
  siteType: s.siteType ?? "",
  powerSource: s.powerSource ?? "",
  battery: s.battery ?? "",
  phone: s.phone ?? "",
  location: s.location ?? "",
  notes: s.notes ?? "",
});

function F({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2" : "space-y-1"}>
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Add (site = null) or edit a site. `offices` = office names to pick from; `lockOffice` for
 *  office admins (their sites stay in their office). */
export function SiteDialog({
  site,
  offices,
  siteTypes,
  lockOffice,
  onClose,
  onSaved,
}: {
  site: Site | null;
  offices: string[];
  siteTypes: string[];
  lockOffice: string | null;
  onClose: () => void;
  onSaved: (s: Site) => void;
}) {
  const [f, setF] = useState<Form>(() =>
    toForm(site ?? { office: lockOffice ?? offices[0] ?? "" }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const { code, ...rest } = f;
    try {
      const r = await api<{ data: Site }>(
        site ? `/api/site-master/${encodeURIComponent(site.code)}` : "/api/site-master",
        {
          method: site ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(site ? rest : { code, ...rest }),
        },
      );
      onSaved(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={site ? `Edit site ${site.code}` : "Add site"}
      onClose={onClose}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" className="bg-white" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !f.office.trim() || (!site && !f.code.trim())}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : site ? "Save changes" : "Add site"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <F label="Site code *" hint={site ? "The code cannot be changed" : "e.g. 0H31DE"}>
          <Input
            className="bg-white font-mono uppercase"
            value={f.code}
            disabled={!!site}
            onChange={set("code")}
            autoFocus={!site}
            required
          />
        </F>
        <F label="Site name">
          <Input className="bg-white" value={f.siteName} onChange={set("siteName")} />
        </F>
        <F label="Office *">
          {lockOffice ? (
            <Input className="bg-white" value={f.office} disabled />
          ) : (
            <>
              <Input
                className="bg-white"
                list="site-offices"
                value={f.office}
                onChange={set("office")}
                required
              />
              <datalist id="site-offices">
                {offices.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </>
          )}
        </F>
        <F label="Nodality" hint="1+0 = not nodal; anything else is nodal">
          <Input
            className="bg-white"
            value={f.nodality}
            placeholder="1+0"
            onChange={set("nodality")}
          />
        </F>
        <F label="Site type">
          <Input
            className="bg-white"
            list="site-types"
            value={f.siteType}
            onChange={set("siteType")}
          />
          <datalist id="site-types">
            {siteTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </F>
        <F label="Power source" hint="DG / HGB / GEN = generator">
          <Input
            className="bg-white"
            value={f.powerSource}
            placeholder="EC+DG"
            onChange={set("powerSource")}
          />
        </F>
        <F label="Battery">
          <Input
            className="bg-white"
            value={f.battery}
            placeholder="YES / NO / status"
            onChange={set("battery")}
          />
        </F>
        <F label="Guard phone" hint="Several numbers: separate with /">
          <Input
            className="bg-white font-mono"
            dir="ltr"
            inputMode="tel"
            value={f.phone}
            onChange={set("phone")}
          />
        </F>
        <F label="Location" hint='Address, "lat, long" or a Google Maps link' wide>
          <Input
            className="bg-white"
            value={f.location}
            placeholder="31.0412, 30.4702"
            onChange={set("location")}
          />
        </F>
        <F label="Notes" wide>
          <textarea
            className="min-h-16 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            value={f.notes}
            onChange={set("notes")}
          />
        </F>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand"
            checked={f.vip}
            onChange={(e) => setF((x) => ({ ...x, vip: e.target.checked }))}
          />
          VIP site
        </label>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: { row: number; code: string; reason: string }[];
  powerUpdated: number;
  powerUnknown: number;
  dismantled: number;
  columns: string[];
  unmappedOffices: string[];
}

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const f = file.current?.files?.[0];
    if (!f) return setError("Choose an .xlsx file first");
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", f);
      const r = await api<{ data: ImportResult }>("/api/site-master/import", {
        method: "POST",
        body,
      });
      setResult(r.data);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import sites from Excel"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" className="bg-white" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button disabled={busy} onClick={() => void upload()}>
            <Upload className="h-4 w-4" />
            {busy ? "Importing…" : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Sheet <b>SiteMaster</b> (or <b>Sites</b>) with at least <b>Code</b> and <b>Office</b>.
          Also read: Site Name, Nodality / Nodal Deg., VIP, Site type / Cascade Type, Power Source,
          Battery / Battaries Status, Guard Number, Location (or Latitude + Longitude), Notes.
          Generator sheets (e.g. <i>OR GEN Sites</i>, <i>Rental GEN</i>) set the power source; codes
          on a <i>Dismantle</i> sheet are left out. Existing codes are updated — only the columns
          the file has.
        </p>
        <a
          href="/api/site-master/template"
          className="inline-flex items-center gap-1.5 text-sky-700 hover:underline"
        >
          <Download className="h-4 w-4" />
          Download the template
        </a>
        <input
          ref={file}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm"
          aria-label="Site Master file"
        />
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {result && (
          <div
            className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
            data-testid="import-summary"
          >
            <p>
              <b>{result.inserted}</b> added · <b>{result.updated}</b> updated ·{" "}
              <b>{result.skipped.length}</b> skipped
              {result.powerUpdated > 0 && (
                <>
                  {" "}
                  · power source of <b>{result.powerUpdated}</b> sites
                </>
              )}
              {result.dismantled > 0 && <> · {result.dismantled} dismantled codes left out</>}
            </p>
            <p className="text-xs text-emerald-800">
              Columns imported: {result.columns.join(", ")}
            </p>
            {result.powerUnknown > 0 && (
              <p className="text-xs text-emerald-800">
                {result.powerUnknown} generator-sheet codes are not in Site Master (ignored).
              </p>
            )}
            {result.unmappedOffices.length > 0 && (
              <p className="text-xs text-amber-800">
                Offices with no matching Gmail office label: {result.unmappedOffices.join(", ")}
              </p>
            )}
            {result.skipped.length > 0 && (
              <ul className="list-inside list-disc text-xs text-emerald-800">
                {result.skipped.slice(0, 20).map((s, i) => (
                  <li key={`${s.row}-${s.code}-${i}`}>
                    {s.row ? `Row ${s.row} ` : ""}
                    {s.code}: {s.reason}
                  </li>
                ))}
                {result.skipped.length > 20 && <li>… and {result.skipped.length - 20} more</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

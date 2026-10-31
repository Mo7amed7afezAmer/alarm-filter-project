// SiteMaster import file (§14). Server-only. Two layouts are read:
// - the template: sheet "SiteMaster", columns Code, Site Name, Office, Nodality, VIP, Site type,
//   Power Source, Battery, Guard Number (= phone; also Phone / Phone Number / Mobile)
//   (+ optional Notes, Location — or Latitude + Longitude);
// - the network DB (DNTH DB, 2026-10-24): sheet "Sites" with Site Code, SC Office, Nodal Deg.
//   (a number: N → "1+(N-1)"), Cascade Type (→ site type), VIP, Battaries Status; extra sheets
//   that only add the power source ("OR GEN Sites" Power Configuration, "Rental GEN"), and a
//   "Dismantle" sheet whose codes are left out.
// Only the columns present in the file are imported: `columns` lists them so a re-import never
// wipes fields the file does not carry (e.g. phones). Other columns are ignored.

import ExcelJS from "exceljs";
import { baseNormalize } from "./normalize.js";
import { regionOf, SITE_CODE_RE } from "./types.js";
import { HourlyReportError } from "./validate.js";

export interface SiteMasterInput {
  code: string;
  siteName: string | null;
  office: string;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  phone: string | null;
  /** Address or "lat, long". */
  location: string | null;
  region: string | null;
  notes: string | null;
}

/** Fields an import may write (code is the key, region follows the code). */
export type SiteMasterField = Exclude<keyof SiteMasterInput, "code" | "region">;

export interface SiteMasterParse {
  rows: SiteMasterInput[];
  /** Fields the file provides; the others must be left as they are on existing sites. */
  columns: SiteMasterField[];
  /** Power source for codes that are not in the main sheet (update existing sites only). */
  patches: { code: string; powerSource: string }[];
  /** Codes listed on a "Dismantle" sheet (not imported). */
  dismantled: string[];
  skipped: { row: number; code: string; reason: string }[];
}

const COLS = {
  code: ["Code", "Site Code", "Short Code"],
  siteName: "Site Name",
  office: ["Office", "SC Office"],
  nodality: ["Nodality", "Nodal Deg.", "Nodal Degree", "Nodal Degree (Integer)"],
  vip: "VIP",
  siteType: ["Site type", "Cascade Type", "Cascade"],
  powerSource: ["Power Source", "Power Configuration", "Power Config"],
  battery: ["Battery", "Batteries", "Battery Status", "Batteries Status", "Battaries Status"],
  phone: ["Guard Number", "Guard Phone", "Phone", "Phone Number", "Mobile", "Contact"],
  notes: "Notes",
  location: [
    "Location",
    "Site Location",
    "Address",
    "Site Address",
    "Coordinates",
    "GPS",
    "Lat Long",
    "Lat/Long",
  ],
  latitude: ["Latitude", "Lat"],
  longitude: ["Longitude", "Long", "Lng", "Lon"],
} as const;
type Key = keyof typeof COLS;
const labels = (k: Key): readonly string[] => {
  const l = COLS[k];
  return typeof l === "string" ? [l] : l;
};
const hk = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function text(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}

const CODE_RE = SITE_CODE_RE;

/**
 * Phone cell → text. Excel often stores mobile numbers as numbers and drops the leading 0
 * (1012345678 → "01012345678"). Several numbers stay separated by " / ".
 */
export function phoneText(raw: string): string | null {
  const parts = raw
    .split(/[/,;|\n]+/)
    // "0101234567 0109876543" = two numbers; "010 123 4567" = one
    .flatMap((p) => {
      const tokens = p.trim().split(/\s+/);
      return tokens.length > 1 && tokens.every((t) => t.replace(/\D/g, "").length >= 8)
        ? tokens
        : [p];
    })
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter((p) => p.length >= 6)
    .map((p) => (/^1\d{9}$/.test(p) ? `0${p}` : p));
  return parts.length ? [...new Set(parts)].join(" / ") : null;
}

/** Location column, else "lat, long" from separate Latitude / Longitude columns. */
export function locationText(location: string, lat: string, long: string): string | null {
  if (location) return location;
  const n = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : "");
  return n(lat) && n(long) ? `${n(lat)}, ${n(long)}` : null;
}

/** Nodal degree as a plain number (DNTH DB) → "1+(N-1)": 1 → "1+0", 3 → "1+2". */
export function nodalityText(raw: string): string | null {
  const v = raw.replace(/\s+/g, "");
  if (!v) return null;
  if (/^\d+$/.test(v)) return `1+${Math.max(0, Number(v) - 1)}`;
  return v;
}

type Sheet = ExcelJS.Worksheet;

function headerIndex(ws: Sheet): Partial<Record<Key, number>> {
  const idx: Partial<Record<Key, number>> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = hk(text(cell.value));
    for (const k of Object.keys(COLS) as Key[])
      if (labels(k).some((l) => hk(l) === h) && idx[k] === undefined) idx[k] = col;
  });
  return idx;
}

const isDismantle = (ws: Sheet) => /dismantl/i.test(ws.name);

export async function parseSiteMasterXlsx(data: Buffer): Promise<SiteMasterParse> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (err) {
    throw new HourlyReportError(
      "BAD_WORKBOOK",
      `Cannot read the Excel file: ${(err as Error).message}`,
    );
  }
  if (!wb.worksheets.length) throw new HourlyReportError("BAD_WORKBOOK", "Workbook has no sheets");

  const sheets = wb.worksheets.map((ws) => ({ ws, idx: headerIndex(ws) }));
  const usable = sheets.filter((s) => !isDismantle(s.ws));
  const main =
    usable.find(
      (s) => ["sitemaster", "sites"].includes(hk(s.ws.name)) && s.idx.code && s.idx.office,
    ) ?? usable.find((s) => s.idx.code && s.idx.office);
  if (!main)
    throw new HourlyReportError(
      "BAD_WORKBOOK",
      `Sheet "${(usable[0] ?? sheets[0])!.ws.name}" needs at least the columns Code and Office`,
    );

  const dismantled = new Set<string>();
  for (const { ws, idx } of sheets.filter((s) => isDismantle(s.ws))) {
    if (!idx.code) continue;
    ws.eachRow((row, rowNo) => {
      const code = text(row.getCell(idx.code!).value).toUpperCase();
      if (rowNo > 1 && CODE_RE.test(code)) dismantled.add(code);
    });
  }

  const { ws, idx } = main;
  const columns: SiteMasterField[] = (
    [
      "siteName",
      "office",
      "nodality",
      "vip",
      "siteType",
      "powerSource",
      "battery",
      "phone",
      "notes",
    ] as const
  ).filter((k) => idx[k]);
  if (idx.location || (idx.latitude && idx.longitude)) columns.push("location");

  const rows: SiteMasterInput[] = [];
  const skipped: SiteMasterParse["skipped"] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const get = (k: Key) => (idx[k] ? text(row.getCell(idx[k]!).value) : "");
    const opt = (k: Key) => get(k) || null;
    const code = get("code").toUpperCase();
    if (!code) return; // blank line
    if (!CODE_RE.test(code)) return void skipped.push({ row: rowNo, code, reason: "invalid code" });
    if (dismantled.has(code)) return void skipped.push({ row: rowNo, code, reason: "dismantled" });
    if (seen.has(code))
      return void skipped.push({ row: rowNo, code, reason: "duplicate code in file" });
    const office = baseNormalize(get("office"));
    if (!office) return void skipped.push({ row: rowNo, code, reason: "office is empty" });
    seen.add(code);
    rows.push({
      code,
      siteName: opt("siteName"),
      office,
      nodality: nodalityText(get("nodality")),
      vip: /^(y|yes|true|1|vip)$/i.test(get("vip")),
      siteType: opt("siteType"),
      powerSource: opt("powerSource"),
      battery: opt("battery"),
      phone: phoneText(get("phone")),
      location: locationText(get("location"), get("latitude"), get("longitude")),
      region: regionOf(code) || null,
      notes: opt("notes"),
    });
  });

  // Extra sheets add only the power source ("OR GEN Sites", "Rental GEN"); applied after the
  // main rows, to them or to sites already stored.
  const patches = new Map<string, string>();
  for (const { ws: extra, idx: x } of usable) {
    if (extra === ws || !x.code || !x.powerSource) continue;
    // A generator sheet whose value does not say so ("Rental") gets " GEN".
    const genSheet = /\bgen/i.test(extra.name);
    extra.eachRow((row, rowNo) => {
      if (rowNo === 1) return;
      const code = text(row.getCell(x.code!).value).toUpperCase();
      let power = text(row.getCell(x.powerSource!).value);
      if (!CODE_RE.test(code) || !power || dismantled.has(code)) return;
      if (genSheet && !/DG|GEN|HGB/i.test(power)) power = `${power} GEN`;
      patches.set(code, power);
    });
  }

  return {
    rows,
    columns,
    patches: [...patches].map(([code, powerSource]) => ({ code, powerSource })),
    dismantled: [...dismantled],
    skipped,
  };
}

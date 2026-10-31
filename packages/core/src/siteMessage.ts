// Site Master page: the site details as a tidy WhatsApp message, and map links for a location.
import { hasGenerator, isNodal } from "./siteFlags.js";

export interface SiteDetails {
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
}

/** "31.0412, 30.4702" (also "31.0412,30.4702" / "31.0412 30.4702") → [lat, long]; else null. */
export function parseCoordinates(location: string | null | undefined): [number, number] | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(location ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const long = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(long) <= 180 ? [lat, long] : null;
}

/** Google Maps link: a link stays as it is, coordinates / an address become a search. */
export function mapsUrl(location: string | null | undefined): string | null {
  const l = (location ?? "").trim();
  if (!l) return null;
  if (/^https?:\/\//i.test(l)) return l;
  const c = parseCoordinates(l);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c ? `${c[0]},${c[1]}` : l)}`;
}

/** WhatsApp message (*bold* title, one detail per line; empty fields left out). */
export function siteWhatsAppText(s: SiteDetails): string {
  const lines: string[] = [`*Site ${s.code}*${s.siteName ? ` — ${s.siteName}` : ""}`];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  add("🏢 Office", s.office);
  add("📍 Region", s.region);
  if (s.vip) lines.push("⭐ VIP: YES");
  add("🔗 Nodality", s.nodality && `${s.nodality}${isNodal(s.nodality) ? " (nodal)" : ""}`);
  add("🏗️ Site type", s.siteType);
  add(
    "⚡ Power",
    s.powerSource && `${s.powerSource}${hasGenerator(s.powerSource) ? " (generator)" : ""}`,
  );
  add("🔋 Battery", s.battery);
  add("📞 Guard", s.phone);
  add("🗺️ Location", s.location);
  const url = mapsUrl(s.location);
  if (url && url !== s.location?.trim()) lines.push(url);
  add("📝 Notes", s.notes);
  return lines.join("\n");
}

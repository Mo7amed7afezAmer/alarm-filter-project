// Site flags and the Gmail-style label chips of the alarm mail view.
// A flag is on when Site Master says so OR the mail carries the Gmail label (user, 2026-10-24).

/** Nodal site = any Site Master nodality except "1+0" (user rule 2026-10-24). */
export function isNodal(nodality: string | null | undefined): boolean {
  const n = (nodality ?? "").replace(/\s+/g, "");
  return n !== "" && n !== "1+0";
}

/** Other operators in a power source: VF = Vodafone, ET = Etisalat, WE = Telecom Egypt. */
export const OTHER_OPERATORS = ["VF", "ET", "WE"] as const;

/** Power comes from another company: a VF / ET / WE word, also glued to DG ("DG/VF", "ETDG",
 *  "DGVF/ET", "EC/WE"). */
export function otherOperatorPower(powerSource: string | null | undefined): boolean {
  const words = (powerSource ?? "").toUpperCase().split(/[^A-Z]+/);
  return words.some((w) =>
    OTHER_OPERATORS.some((op) => w === op || w === `${op}DG` || w === `DG${op}`),
  );
}

/** Site has its own generator: Site Master power source mentions DG / GEN / HGB ("EC+DG", "HGB",
 *  "EC+Cont DG", "Rental GEN", …) and is not another company's (user rule 2026-10-25). */
export function hasGenerator(powerSource: string | null | undefined): boolean {
  return /DG|GEN|HGB/i.test(powerSource ?? "") && !otherOperatorPower(powerSource);
}

export type BatteryState = "ok" | "weak" | "none" | "unknown";

/** Words in a battery status that mean no batteries / bad batteries (DNTH DB "Battaries Status"
 *  is free text: "No Batteries - D9", "Complete Stolen", "Faulty Batteries", "New Lithium …"). */
export const BATTERY_NONE = ["no batter", "stolen", "none"] as const;
export const BATTERY_WEAK = ["faulty", "weak"] as const;

/** null / empty = unknown; "NO" or none-words = none; faulty / weak = weak; else ok. */
export function batteryState(battery: string | null | undefined): BatteryState | null {
  const b = (battery ?? "").trim().toLowerCase();
  if (!b) return null;
  if (b === "no" || BATTERY_NONE.some((w) => b.includes(w))) return "none";
  if (BATTERY_WEAK.some((w) => b.includes(w))) return "weak";
  if (b.includes("investigation")) return "unknown";
  return "ok";
}

export type SiteTag = "VIP" | "NODAL" | "BATT" | "GEN";
export type ChipKind = "ALM" | "CLR" | SiteTag | "label";

export interface MailChip {
  label: string;
  kind: ChipKind;
}

/** Gmail labels that say nothing about the alarm. */
const NOISE = new Set(["INBOX", "STARRED", "IMPORTANT", "YELLOW_STAR", "ALM", "CLR"]);
/** Gmail labels that are a site tag. */
const TAG_LABELS: Record<string, SiteTag> = {
  VIP: "VIP",
  NDLN: "NODAL",
  NODAL: "NODAL",
  GEN: "GEN",
};

/**
 * Text tags of a site, only those it has, in the order VIP, NODAL, BATT, GEN (user, 2026-10-25).
 * A tag is on when Site Master says so OR the mail carries the Gmail label; GEN never shows when
 * the power source is another company's. BATT = batteries present and not weak.
 */
export function siteTags(a: {
  vip: boolean | null;
  nodality: string | null;
  battery?: string | null;
  powerSource: string | null;
  labels?: readonly string[];
}): SiteTag[] {
  const fromLabels = new Set((a.labels ?? []).map((l) => TAG_LABELS[l]).filter(Boolean));
  const tags: SiteTag[] = [];
  if (a.vip || fromLabels.has("VIP")) tags.push("VIP");
  if (isNodal(a.nodality) || fromLabels.has("NODAL")) tags.push("NODAL");
  if (batteryState(a.battery) === "ok") tags.push("BATT");
  if (hasGenerator(a.powerSource) || (fromLabels.has("GEN") && !otherOperatorPower(a.powerSource)))
    tags.push("GEN");
  return tags;
}

/**
 * Chips in Gmail order: status (ALM / CLR), the site tags, then the mail's other labels.
 * `labels` = labels of the alarm mail (+ the Clear mail); the status chip comes from the alarm.
 * The office is not shown (user, 2026-10-25): `office` and nested labels ("DN/Tanta") are dropped.
 */
export function mailChips(a: {
  cleared: boolean;
  office: string | null;
  labels: readonly string[];
  vip: boolean | null;
  nodality: string | null;
  battery?: string | null;
  powerSource: string | null;
}): MailChip[] {
  const labels = [...new Set(a.labels)].filter(
    (l) => !NOISE.has(l) && l !== a.office && !l.includes("/"),
  );
  const chips: MailChip[] = [{ label: a.cleared ? "CLR" : "ALM", kind: a.cleared ? "CLR" : "ALM" }];
  for (const t of siteTags({ ...a, labels })) chips.push({ label: t, kind: t });
  for (const l of labels) if (!TAG_LABELS[l]) chips.push({ label: l, kind: "label" });
  return chips;
}

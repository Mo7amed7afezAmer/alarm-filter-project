// Alarm list queries shared by /api/alarms/* and /api/export.
import { hasGenerator, isNodal, otherOperatorPower, siteCodeOf } from "@alarm/core";
import { prisma, type Prisma } from "@alarm/db";
import { z } from "zod";
import { category, dateParam, pagination } from "../common/http.js";
import { getOffice } from "./office.js";
import { alarmScope } from "./visibility.js";

export const SITE_FLAGS = ["vip", "nodal", "generator"] as const;
export type SiteFlag = (typeof SITE_FLAGS)[number];

export const activeQuery = z.object({
  category: category.optional(),
  /** Alarm name, site, site code or cell. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Sites with this tag (Site Master or the mail's Gmail label, like the mail-view tags). */
  flag: z.enum(SITE_FLAGS).optional(),
  /** Super admin viewing all offices: one office. Ignored for office-scoped users. */
  office: z.string().trim().min(1).max(100).optional(),
  site: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().min(1).max(100).optional(),
  minHours: z.coerce
    .number()
    .min(0)
    .max(24 * 365)
    .optional(),
  ...pagination,
});

export const clearedQuery = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  category: category.optional(),
  site: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().min(1).max(100).optional(),
  ...pagination,
});

async function sitesInRegion(region: string): Promise<string[]> {
  const rows = await prisma.site.findMany({
    where: { region: { equals: region, mode: "insensitive" } },
    select: { site: true },
  });
  return rows.map((r) => r.site);
}

const FLAG_LABEL: Record<SiteFlag, string[]> = {
  vip: ["VIP"],
  nodal: ["NDLN", "NODAL"],
  generator: ["GEN"],
};

/** Alarms whose site has the tag — same rule as siteTags() in @alarm/core. */
async function siteFlagWhere(flag: SiteFlag): Promise<Prisma.AlarmWhereInput> {
  const masters = await prisma.siteMaster.findMany({
    select: { code: true, vip: true, nodality: true, powerSource: true },
  });
  const has = (m: (typeof masters)[number]) =>
    flag === "vip" ? m.vip : flag === "nodal" ? isNodal(m.nodality) : hasGenerator(m.powerSource);
  const byLabel: Prisma.AlarmWhereInput[] = [
    { rawMessage: { labels: { hasSome: FLAG_LABEL[flag] } } },
  ];
  if (flag === "generator") {
    // A GEN label never counts on another company's power.
    const other = masters.filter((m) => otherOperatorPower(m.powerSource)).map((m) => m.code);
    if (other.length) byLabel.push({ OR: [{ siteCode: null }, { siteCode: { notIn: other } }] });
  }
  return { OR: [{ siteCode: { in: masters.filter(has).map((m) => m.code) } }, { AND: byLabel }] };
}

export async function activeWhere(
  q: z.infer<typeof activeQuery>,
  userId?: number,
  now = new Date(),
): Promise<Prisma.AlarmWhereInput> {
  // Office + hidden types first; user filters are AND-ed on top (they cannot un-hide a type).
  const and: Prisma.AlarmWhereInput[] = [await alarmScope(userId), { status: "ACTIVE" }];
  if (q.category) and.push({ category: q.category });
  if (q.site) and.push({ site: { contains: q.site, mode: "insensitive" } });
  if (q.region) and.push({ site: { in: await sitesInRegion(q.region) } });
  if (q.q)
    and.push({
      OR: (["alarmName", "site", "siteCode", "cellName"] as const).map((f) => ({
        [f]: { contains: q.q, mode: "insensitive" },
      })),
    });
  if (q.flag) and.push(await siteFlagWhere(q.flag));
  if (q.office && (await getOffice(userId)) === null) and.push({ office: q.office });
  if (q.minHours !== undefined)
    and.push({ alarmTime: { lte: new Date(now.getTime() - q.minHours * 3_600_000) } });
  return { AND: and };
}

/** Default window: last 24h by clearTime. */
export async function clearedWhere(
  q: z.infer<typeof clearedQuery>,
  userId?: number,
  now = new Date(),
) {
  const from = q.from ?? new Date(now.getTime() - 24 * 3_600_000);
  const to = q.to ?? now;
  const and: Prisma.AlarmWhereInput[] = [
    await alarmScope(userId),
    { status: "CLEARED", clearTime: { gte: from, lte: to } },
  ];
  if (q.category) and.push({ category: q.category });
  if (q.site) and.push({ site: { contains: q.site, mode: "insensitive" } });
  if (q.region) and.push({ site: { in: await sitesInRegion(q.region) } });
  const where: Prisma.AlarmWhereInput = { AND: and };
  return { where, from, to };
}

export const alarmSelect = {
  id: true,
  alarmName: true,
  site: true,
  category: true,
  alarmTime: true,
  status: true,
  clearTime: true,
  durationMin: true,
  clearType: true,
  cellName: true,
  device: true,
  consecNbr: true,
  office: true,
  // The alarm mail and the Clear mail: arrival time + Gmail labels for the mail view.
  rawMessage: { select: { subject: true, receivedAt: true, labels: true } },
  clearMessage: { select: { subject: true, receivedAt: true, labels: true } },
} as const;

/**
 * Adds `region` / `owner` from the sites table, and the Site Master data (VIP, nodality,
 * battery, phone, …) joined on the site code = last "_" segment of the site name.
 * Site Master fields are null when the code is not imported (`vip` null = unknown).
 */
export async function withSiteInfo<T extends { site: string }>(rows: T[]) {
  const codes = [...new Set(rows.map((r) => siteCodeOf(r.site)).filter((c): c is string => !!c))];
  const [sites, masters] = await Promise.all([
    prisma.site.findMany({ where: { site: { in: [...new Set(rows.map((r) => r.site))] } } }),
    codes.length ? prisma.siteMaster.findMany({ where: { code: { in: codes } } }) : [],
  ]);
  const bySite = new Map(sites.map((s) => [s.site, s]));
  const byCode = new Map(masters.map((m) => [m.code, m]));
  return rows.map((r) => {
    const code = siteCodeOf(r.site);
    const m = code ? byCode.get(code) : undefined;
    return {
      ...r,
      region: bySite.get(r.site)?.region ?? m?.region ?? null,
      owner: bySite.get(r.site)?.owner ?? null,
      siteCode: code,
      vip: m ? m.vip : null,
      nodality: m?.nodality ?? null,
      battery: m?.battery ?? null,
      phone: m?.phone ?? null,
      siteType: m?.siteType ?? null,
      powerSource: m?.powerSource ?? null,
    };
  });
}

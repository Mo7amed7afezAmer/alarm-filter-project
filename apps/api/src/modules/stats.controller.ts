// Dashboard statistics (§9).
import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { ALARM_TZ, parseQuery } from "../common/http.js";
import { CurrentUser } from "../common/nest.js";
import { officeFilter } from "../lib/office.js";
import { alarmScope, alarmScopeSql } from "../lib/visibility.js";

const CATEGORIES = ["DOWN", "POWER", "OTHER"] as const;

const summaryQuery = z.object({
  /** MTTR window in days. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});
const dailyQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const topSitesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** YYYY-MM-DD of `d` in the alarm timezone. */
function localDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALARM_TZ }).format(d);
}

@Controller("stats")
export class StatsController {
  @Get("summary")
  async summary(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { days } = parseQuery(req, summaryQuery);
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);
    const day = new Date(now.getTime() - 86_400_000);
    const alertHours = Number(process.env.ALERT_HOURS) || 4;
    const office = await officeFilter(user.id); // orphan/raw counts (not alarm types)
    const scope = await alarmScope(user.id); // alarms: office + hidden types

    const [active, mttr, overdue, status, orphans24h, parseErrors24h, cleared24h] =
      await Promise.all([
        prisma.alarm.groupBy({
          by: ["category"],
          where: { AND: [scope, { status: "ACTIVE" }] },
          _count: { _all: true },
        }),
        // MTTR: EMAIL clears only — AUTO_SUPERSEDED is not a repair.
        prisma.alarm.groupBy({
          by: ["category"],
          where: {
            AND: [scope, { status: "CLEARED", clearType: "EMAIL", clearTime: { gte: since } }],
          },
          _avg: { durationMin: true },
          _count: { _all: true },
        }),
        prisma.alarm.count({
          where: {
            AND: [
              scope,
              {
                status: "ACTIVE",
                alarmTime: { lte: new Date(now.getTime() - alertHours * 3_600_000) },
              },
            ],
          },
        }),
        prisma.systemStatus.findUnique({ where: { id: 1 } }),
        prisma.orphanClear.count({ where: { clearTime: { gte: day }, ...office } }),
        prisma.rawMessage.count({
          where: { receivedAt: { gte: day }, parseError: { not: null }, ...office },
        }),
        prisma.alarm.count({
          where: { AND: [scope, { status: "CLEARED", clearTime: { gte: day } }] },
        }),
      ]);

    const activeBy = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
    for (const r of active) activeBy[r.category] = r._count._all;

    const mttrBy = Object.fromEntries(
      CATEGORIES.map((c) => {
        const r = mttr.find((m) => m.category === c);
        return [
          c,
          {
            avgMin: r?._avg.durationMin != null ? Math.round(r._avg.durationMin) : null,
            count: r?._count._all ?? 0,
          },
        ];
      }),
    );

    const lastRunAt = status?.lastRunAt ?? null;
    return {
      active: { ...activeBy, total: Object.values(activeBy).reduce((a, b) => a + b, 0) },
      overdue: { count: overdue, alertHours },
      mttr: { days, byCategory: mttrBy },
      last24h: { cleared: cleared24h, orphanClears: orphans24h, parseErrors: parseErrors24h },
      office: office.office ?? null,
      lastRun: {
        at: lastRunAt,
        ageSec: lastRunAt ? Math.round((now.getTime() - lastRunAt.getTime()) / 1000) : null,
        messages: status?.lastRunMessages ?? 0,
        error: status?.lastError ?? null,
        reprocessPending: status?.reprocessDays ?? null,
      },
    };
  }

  /** Alarms raised per local day and category (by alarmTime). */
  @Get("daily")
  async daily(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { days } = parseQuery(req, dailyQuery);
    const now = new Date();
    const dayList = Array.from({ length: days }, (_, i) =>
      localDay(new Date(now.getTime() - (days - 1 - i) * 86_400_000)),
    );
    const since = new Date(now.getTime() - (days + 1) * 86_400_000); // over-fetch, trimmed below

    const { allOffices, officeExact, officePrefix, admin, mine } = await alarmScopeSql(user.id);
    // alarmTime is stored as UTC timestamp without zone.
    const rows = await prisma.$queryRaw<{ day: string; category: string; count: number }[]>`
      SELECT to_char(("alarmTime" AT TIME ZONE 'UTC') AT TIME ZONE ${ALARM_TZ}, 'YYYY-MM-DD') AS day,
             category::text AS category,
             count(*)::int AS count
      FROM alarms
      WHERE "alarmTime" >= ${since}
        AND (${allOffices}::boolean OR office = ${officeExact}::text OR office LIKE ${officePrefix}::text)
        AND (category::text = ANY(${admin.hiddenCategories}::text[]) OR "alarmName" = ANY(${admin.hiddenAlarmNames}::text[]))
            = (COALESCE("siteCode" = ANY(ARRAY(SELECT jsonb_array_elements_text(${admin.exceptions}::jsonb -> "alarmName"))), false)
               OR upper(site) = ANY(ARRAY(SELECT jsonb_array_elements_text(${admin.exceptions}::jsonb -> "alarmName"))))
        AND (category::text = ANY(${mine.hiddenCategories}::text[]) OR "alarmName" = ANY(${mine.hiddenAlarmNames}::text[]))
            = (COALESCE("siteCode" = ANY(ARRAY(SELECT jsonb_array_elements_text(${mine.exceptions}::jsonb -> "alarmName"))), false)
               OR upper(site) = ANY(ARRAY(SELECT jsonb_array_elements_text(${mine.exceptions}::jsonb -> "alarmName"))))
      GROUP BY 1, 2`;

    const byDay = new Map(dayList.map((d) => [d, { day: d, DOWN: 0, POWER: 0, OTHER: 0 }]));
    for (const r of rows) {
      const bucket = byDay.get(r.day);
      if (bucket && (r.category === "DOWN" || r.category === "POWER" || r.category === "OTHER")) {
        bucket[r.category] = r.count;
      }
    }
    return { days, timeZone: ALARM_TZ, series: [...byDay.values()] };
  }

  /** Sites with the most alarms raised in the last `days`, with their current active count. */
  @Get("top-sites")
  async topSites(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { limit, days } = parseQuery(req, topSitesQuery);
    const since = new Date(Date.now() - days * 86_400_000);
    const scope = await alarmScope(user.id);

    const top = await prisma.alarm.groupBy({
      by: ["site"],
      where: { AND: [scope, { alarmTime: { gte: since } }] },
      _count: { _all: true },
      orderBy: { _count: { site: "desc" } },
      take: limit,
    });
    const sites = top.map((t) => t.site);
    const [active, info] = await Promise.all([
      prisma.alarm.groupBy({
        by: ["site"],
        where: { AND: [scope, { status: "ACTIVE", site: { in: sites } }] },
        _count: { _all: true },
      }),
      prisma.site.findMany({ where: { site: { in: sites } } }),
    ]);
    const activeBy = new Map(active.map((a) => [a.site, a._count._all]));
    const infoBy = new Map(info.map((s) => [s.site, s]));

    return {
      days,
      items: top.map((t) => ({
        site: t.site,
        total: t._count._all,
        active: activeBy.get(t.site) ?? 0,
        region: infoBy.get(t.site)?.region ?? null,
      })),
    };
  }
}

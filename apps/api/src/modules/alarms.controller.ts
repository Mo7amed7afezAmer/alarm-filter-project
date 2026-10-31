// Alarm lists, alarm names and the Excel export (§9).
import { Controller, Get, Req, Res } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Request, Response } from "express";
import { z } from "zod";
import { isOfficeGroup } from "@alarm/core";
import { prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { ALARM_TZ, HttpError, paged, parseQuery, searchParams } from "../common/http.js";
import { CurrentUser } from "../common/nest.js";
import { getOffice, officeFilter } from "../lib/office.js";
import {
  activeQuery,
  activeWhere,
  alarmSelect,
  clearedQuery,
  clearedWhere,
  withSiteInfo,
} from "../lib/queries.js";
import { getDisplayFilter, getUserDisplayFilter } from "../lib/visibility.js";

const MAX_EXPORT_ROWS = 50_000;

/** Wall-clock string in ALARM_TZ so Excel shows local times (Excel has no timezones). */
function local(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ALARM_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);
}

@Controller()
export class AlarmsController {
  /** Also returns `categories` (count per category with every other filter applied — the page's
   *  tabs) and, for a super admin viewing all offices, `offices` (count per office). */
  @Get("alarms/active")
  async active(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const q = parseQuery(req, activeQuery);
    const where = await activeWhere(q, user.id);
    // the office filter: a super admin looking at all offices or at an office group
    const scope = await getOffice(user.id);
    const allOffices = scope === null || isOfficeGroup(scope);
    const [total, rows, byCategory, byOffice] = await Promise.all([
      prisma.alarm.count({ where }),
      prisma.alarm.findMany({
        where,
        select: alarmSelect,
        orderBy: [{ alarmTime: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.alarm.groupBy({
        by: ["category"],
        where: await activeWhere({ ...q, category: undefined }, user.id),
        _count: { _all: true },
      }),
      allOffices
        ? prisma.alarm.groupBy({
            by: ["office"],
            where: await activeWhere({ ...q, office: undefined }, user.id),
            _count: { _all: true },
            orderBy: { office: "asc" },
          })
        : [],
    ]);
    return {
      ...paged(await withSiteInfo(rows), total, q.page, q.pageSize),
      categories: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])),
      offices: byOffice
        .filter((o) => o.office)
        .map((o) => ({ office: o.office as string, count: o._count._all })),
    };
  }

  @Get("alarms/cleared")
  async cleared(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const q = parseQuery(req, clearedQuery);
    const { where, from, to } = await clearedWhere(q, user.id);
    const [total, rows] = await Promise.all([
      prisma.alarm.count({ where }),
      prisma.alarm.findMany({
        where,
        select: alarmSelect,
        orderBy: [{ clearTime: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ...paged(await withSiteInfo(rows), total, q.page, q.pageSize), from, to };
  }

  /** Distinct alarm names seen in the current office (last 30 days), most frequent first.
   *  Hidden types (by the admin or by this user) are left out unless `?all=1` — the hide/show
   *  editors need the full list, each row flagged `hiddenByAdmin` / `hiddenByMe`. */
  @Get("alarm-names")
  async alarmNames(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const all = searchParams(req).get("all") === "1";
    const [rows, admin, mine] = await Promise.all([
      prisma.alarm.groupBy({
        by: ["alarmName", "category"],
        where: {
          alarmTime: { gte: new Date(Date.now() - 30 * 86_400_000) },
          ...(await officeFilter(user.id)),
        },
        _count: { _all: true },
        orderBy: { _count: { alarmName: "desc" } },
        take: 300,
      }),
      getDisplayFilter(),
      getUserDisplayFilter(user.id),
    ]);
    const names = rows
      .map((r) => {
        const hiddenByAdmin =
          admin.hiddenCategories.includes(r.category) ||
          admin.hiddenAlarmNames.includes(r.alarmName);
        const hiddenByMe =
          mine.hiddenCategories.includes(r.category) || mine.hiddenAlarmNames.includes(r.alarmName);
        return {
          name: r.alarmName,
          category: r.category,
          count: r._count._all,
          hidden: hiddenByAdmin || hiddenByMe,
          hiddenByAdmin,
          hiddenByMe,
        };
      })
      .filter((n) => all || !n.hidden);
    return { names };
  }

  @Get("export")
  async export(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const status = searchParams(req).get("status");
    if (status !== "active" && status !== "cleared")
      throw new HttpError(400, "status must be active or cleared");

    const where =
      status === "active"
        ? await activeWhere(parseQuery(req, activeQuery.extend({ status: z.string() })), user.id)
        : (
            await clearedWhere(
              parseQuery(req, clearedQuery.extend({ status: z.string() })),
              user.id,
            )
          ).where;

    const count = await prisma.alarm.count({ where });
    if (count > MAX_EXPORT_ROWS)
      throw new HttpError(
        413,
        `Too many rows (${count}); narrow the filters (max ${MAX_EXPORT_ROWS})`,
      );

    const rows = await withSiteInfo(
      await prisma.alarm.findMany({
        where,
        select: alarmSelect,
        orderBy: status === "active" ? { alarmTime: "desc" } : { clearTime: "desc" },
      }),
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(status === "active" ? "Active alarms" : "Cleared alarms");
    ws.columns = [
      { header: "Alarm", key: "alarmName", width: 42 },
      { header: "Site", key: "site", width: 36 },
      { header: "Cell", key: "cellName", width: 26 },
      { header: "Device", key: "device", width: 10 },
      { header: "CONSEC_NBR", key: "consecNbr", width: 12 },
      { header: "Region", key: "region", width: 14 },
      { header: "Site code", key: "siteCode", width: 10 },
      { header: "VIP", key: "vipText", width: 6 },
      { header: "Nodality", key: "nodality", width: 10 },
      { header: "Battery", key: "battery", width: 9 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Category", key: "category", width: 10 },
      { header: `Alarm time (${ALARM_TZ})`, key: "alarmTime", width: 22 },
      ...(status === "cleared"
        ? [
            { header: `Clear time (${ALARM_TZ})`, key: "clearTime", width: 22 },
            { header: "Duration (min)", key: "durationMin", width: 14 },
            { header: "Clear type", key: "clearType", width: 18 },
          ]
        : [{ header: "Age (hours)", key: "ageHours", width: 12 }]),
    ];
    const now = Date.now();
    for (const r of rows) {
      ws.addRow({
        ...r,
        alarmTime: local(r.alarmTime),
        clearTime: local(r.clearTime),
        vipText: r.vip === null ? "" : r.vip ? "YES" : "NO",
        ageHours: Math.round(((now - r.alarmTime.getTime()) / 3_600_000) * 10) / 10,
      });
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    res
      .status(200)
      .set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="alarms-${status}-${stamp}.xlsx"`,
      })
      .end(Buffer.from(buf));
  }
}

// Super-admin settings: classification rules, reprocess, hidden alarm types, office view.
import { Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { classify, officeGroups } from "@alarm/core";
import { prisma, type Prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { category, HttpError, parseBody, parseQuery } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { availableOffices, getOffice } from "../lib/office.js";
import { getDisplayFilter, normalizeDisplayFilter } from "../lib/visibility.js";

const rulesBody = z.object({
  rules: z
    .array(
      z.object({
        pattern: z.string().trim().min(1).max(100),
        category,
        priority: z.coerce.number().int().min(0).max(100_000),
      }),
    )
    .max(500),
});

const reprocessQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

const displayBody = z.object({
  hiddenCategories: z.array(category).max(3),
  hiddenAlarmNames: z.array(z.string().trim().min(1).max(200)).max(1000),
  /** Site codes / full site names where the hidden types still show. */
  exceptSites: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
});

async function listRules() {
  return prisma.rule.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] });
}

@Controller()
export class SettingsController {
  @Get("rules")
  @Roles("SUPER_ADMIN")
  async rules() {
    return { rules: await listRules() };
  }

  /** Replace all rules, then re-classify existing alarms (one UPDATE per distinct alarm name). */
  @Put("rules")
  @Roles("SUPER_ADMIN")
  async putRules(@Req() req: Request) {
    const { rules } = await parseBody(req, rulesBody);

    const reclassified = await prisma.$transaction(async (tx) => {
      await tx.rule.deleteMany();
      if (rules.length) await tx.rule.createMany({ data: rules });

      const names = await tx.alarm.groupBy({ by: ["alarmName", "category"] });
      let changed = 0;
      for (const n of names) {
        const next = classify(n.alarmName, rules);
        if (next !== n.category) {
          const r = await tx.alarm.updateMany({
            where: { alarmName: n.alarmName, category: n.category },
            data: { category: next },
          });
          changed += r.count;
        }
      }
      return changed;
    });

    return { rules: await listRules(), reclassified };
  }

  /** Queues a rebuild; the worker runs it on its next tick and clears reprocessDays. */
  @Post("reprocess")
  @Roles("SUPER_ADMIN")
  @HttpCode(202)
  async reprocess(@Req() req: Request) {
    const { days } = parseQuery(req, reprocessQuery);
    await prisma.systemStatus.upsert({
      where: { id: 1 },
      update: { reprocessDays: days },
      create: { id: 1, reprocessDays: days },
    });
    return { queued: true, days };
  }

  /** Alarm types hidden from display (any signed-in user may read it). */
  @Get("settings/display")
  async display() {
    return getDisplayFilter();
  }

  /** Replace the hidden lists (super admin). Hidden alarms are still stored and matched. */
  @Put("settings/display")
  @Roles("SUPER_ADMIN")
  async putDisplay(@Req() req: Request) {
    const filter = normalizeDisplayFilter(await parseBody(req, displayBody));
    await prisma.systemStatus.upsert({
      where: { id: 1 },
      update: { displayFilter: filter as unknown as Prisma.InputJsonValue },
      create: { id: 1, displayFilter: filter as unknown as Prisma.InputJsonValue },
    });
    return filter;
  }

  /** Office the user is looking at (null = all offices), the offices to choose from, and the
   *  worker's sync state (it reads the whole mailbox; "*" once the backfill is done). */
  @Get("settings/office")
  async office(@CurrentUser() user: AuthUser) {
    const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
    return {
      office: await getOffice(user.id),
      synced: s?.syncedLabel === "*",
      offices: await availableOffices(),
    };
  }

  /** Super admin: switch the office being viewed (their account only): an office label, an
   *  office group ("DN"), or null/"" = all offices.
   *  Office users are fixed to their own office. */
  @Put("settings/office")
  @Roles("SUPER_ADMIN")
  async putOffice(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { office } = await parseBody(
      req,
      z.object({ office: z.string().trim().max(200).nullable() }),
    );
    // an office label, or an office group ("DN" = every DN/… office)
    const offices = await availableOffices();
    if (
      office &&
      offices.length &&
      !offices.includes(office) &&
      !officeGroups(offices).includes(office)
    ) {
      throw new HttpError(400, `Unknown office label "${office}"`);
    }
    await prisma.user.update({ where: { id: user.id }, data: { office: office || null } });
    return { office: office || null };
  }
}

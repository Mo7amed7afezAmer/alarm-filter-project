// The signed-in user's own data: profile, personal hidden types, notification prefs and feed.
import { Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { normalizePrefs, normalizeUiPrefs, scopeOfficeOf } from "@alarm/core";
import { prisma, type Prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { category, parseBody } from "../common/http.js";
import { CurrentUser } from "../common/nest.js";
import { loadUserPrefs, notificationFeed } from "../lib/notifications.js";
import {
  getDisplayFilter,
  getUserDisplayFilter,
  hiddenCount,
  normalizeDisplayFilter,
} from "../lib/visibility.js";

const displayBody = z.object({
  hiddenCategories: z.array(category).max(3),
  hiddenAlarmNames: z.array(z.string().trim().min(1).max(200)).max(1000),
  /** Site codes / full site names where the hidden types still show. */
  exceptSites: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
});

const prefsBody = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  categories: z.array(category).max(3),
  alarmNames: z.array(z.string().trim().min(1).max(200)).max(500),
  sites: z.array(z.string().trim().min(1).max(200)).max(100),
});

const uiPrefsBody = z.object({
  theme: z.string().max(20),
  alarms: z.object({
    view: z.string().max(10).optional(),
    siteInfoIcons: z.boolean(),
    groupBySite: z.boolean(),
    mailGroupBySite: z.boolean().optional(),
    hiddenColumns: z.record(z.array(z.string().max(40)).max(40)),
    mail: z.record(z.boolean()).optional(),
  }),
  // Hourly output settings: shapes are checked loosely here, normalizeHourlyPrefs cleans them.
  hourly: z
    .object({
      hiddenSheets: z.array(z.string().max(40)).max(20),
      hiddenCategories: z.array(z.string().max(10)).max(3),
      hiddenAlarms: z.array(z.string().max(200)).max(1000),
      tableColumns: z.array(z.string().max(40)).max(40),
      sort: z.string().max(10),
      colors: z.object({
        enabled: z.boolean(),
        rules: z
          .array(
            z.object({
              kind: z.string().max(10),
              hours: z.number().optional(),
              office: z.string().max(100).optional(),
              color: z.string().max(10),
              columns: z.array(z.string().max(40)).max(40),
            }),
          )
          .max(30),
      }),
      images: z.record(z.object({ enabled: z.boolean(), byOffice: z.boolean() })),
      split: z.object({ mode: z.string().max(20), byOffice: z.boolean() }),
      imageRowsPerPage: z.number(),
    })
    .optional(),
});

@Controller()
export class MeController {
  /** Who am I + what the web header shows (role, office scope, hidden-type counts). */
  @Get("me")
  async me(@CurrentUser() user: AuthUser) {
    const [admin, mine] = await Promise.all([getDisplayFilter(), getUserDisplayFilter(user.id)]);
    return {
      user,
      office: scopeOfficeOf(user),
      timeZone: process.env.ALARM_TZ || "Africa/Cairo",
      alertHours: Number(process.env.ALERT_HOURS) || 4,
      hiddenTypes: hiddenCount(admin),
      myHiddenTypes: hiddenCount(mine),
    };
  }

  /** The signed-in user's personal hidden types, plus what the admin hides for everyone. */
  @Get("me/display")
  async display(@CurrentUser() user: AuthUser) {
    const [mine, admin] = await Promise.all([getUserDisplayFilter(user.id), getDisplayFilter()]);
    return { ...mine, admin };
  }

  /** Replace the user's own hidden types (any role). Affects only this user's pages. */
  @Put("me/display")
  async putDisplay(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const filter = normalizeDisplayFilter(await parseBody(req, displayBody));
    await prisma.user.update({
      where: { id: user.id },
      data: { displayPrefs: filter as unknown as Prisma.InputJsonValue },
    });
    return filter;
  }

  /** Personal UI settings (theme, alarm table columns / grouping). Defaults when never saved. */
  @Get("me/ui-prefs")
  async uiPrefs(@CurrentUser() user: AuthUser) {
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { uiPrefs: true } });
    return { prefs: normalizeUiPrefs(u?.uiPrefs) };
  }

  /** Replace the user's UI settings (any role); unknown values fall back to the defaults. */
  @Put("me/ui-prefs")
  async putUiPrefs(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const prefs = normalizeUiPrefs(await parseBody(req, uiPrefsBody));
    await prisma.user.update({
      where: { id: user.id },
      data: { uiPrefs: prefs as unknown as Prisma.InputJsonValue },
    });
    return { prefs };
  }

  /** Every user (viewer or admin) manages their own preferences. */
  @Get("me/notification-prefs")
  async prefs(@CurrentUser() user: AuthUser) {
    const { prefs } = await loadUserPrefs(user.id);
    return { prefs };
  }

  @Put("me/notification-prefs")
  async putPrefs(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const prefs = normalizePrefs(await parseBody(req, prefsBody));
    await prisma.user.update({
      where: { id: user.id },
      // NotifyPrefs is plain JSON (booleans + string arrays).
      data: { notifyPrefs: prefs as unknown as Prisma.InputJsonValue },
    });
    return { prefs };
  }

  /** The signed-in user's notification feed (polled by the header bell). */
  @Get("notifications")
  async notifications(@CurrentUser() user: AuthUser) {
    return notificationFeed(user.id);
  }

  /** Mark everything up to now as read. */
  @Post("notifications/read")
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser) {
    const seenAt = new Date();
    await prisma.user.update({ where: { id: user.id }, data: { notificationsSeenAt: seenAt } });
    return { seenAt };
  }
}

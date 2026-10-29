// Hourly reports (§14, stateless): list from Gmail, process into the in-process cache, read rows,
// export, compare. Plus the normalization rules applied while processing.
import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  diffHourly,
  filterHourlyRows,
  hourlyFacets,
  hourlyCellFill,
  hourlySortFor,
  NORMALIZED_FIELDS,
  normalizeHourlyPrefs,
  parseHourlySort,
  sortHourlyRows,
  splitHourlyRows,
  visibleHourlyRows,
  wallClockOf,
} from "@alarm/core";
import { buildHourlyXlsx } from "@alarm/core/hourly";
import {
  getHourlySettings,
  HOURLY_DEFAULT_KEY,
  hourlyEditKey,
  prisma,
  type Prisma,
} from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { dateParam, HttpError, parseBody, parseQuery, searchParams } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { hourlySource } from "../lib/gmail.js";
import { getOffice } from "../lib/office.js";
import {
  checkGmailId,
  collectState,
  COLLECT_REPORTS,
  getReport,
  hourlyCache,
  parseColumns,
  parseFilters,
  scopeRows,
  startCollect,
  startProcessing,
} from "../lib/hourly.js";

const PAGE_SIZE = 25;
const DAY = 86_400_000;

const listQuery = z.object({
  from: dateParam.optional(),
  /** A date-only `to` includes that whole day. */
  to: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
    .transform((s) => new Date(Date.parse(s) + (/^\d{4}-\d{2}-\d{2}$/.test(s) ? DAY : 0)))
    .optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  /** Reports per page (the Hourly Alarms list asks for 10). */
  pageSize: z.coerce.number().int().min(1).max(50).default(PAGE_SIZE),
});

const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const normalizationRule = z.object({
  field: z.enum(["*", ...NORMALIZED_FIELDS]),
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().max(200),
});

const listNormalizations = () =>
  prisma.hourlyNormalization.findMany({ orderBy: [{ field: "asc" }, { from: "asc" }] });

/** The settings row this user edits (null = read-only). */
async function editKeyFor(user: AuthUser): Promise<string | null> {
  return hourlyEditKey(user, await getOffice(user.id));
}

/** Settings the user's hourly pages use (their office's, else the default) + what they may edit. */
async function settingsView(user: AuthUser) {
  const [resolved, editKey] = await Promise.all([
    getHourlySettings(prisma, await getOffice(user.id)),
    editKeyFor(user),
  ]);
  return {
    data: resolved.prefs,
    meta: {
      /** Row the settings came from: an office label, "*" (default) or null (built-in). */
      source: resolved.source,
      /** Row a save writes (null = read-only). */
      editKey,
      /** The edited office has its own row (else it uses the default). */
      own: !!editKey && resolved.source === editKey,
    },
  };
}

@Controller()
export class HourlyController {
  /** Hourly report settings shared per office (Settings → Alarms, images & colours): every user
   *  reads the ones their pages use; office admins / the super admin can edit them. */
  @Get("hourly-settings")
  hourlySettings(@CurrentUser() user: AuthUser) {
    return settingsView(user);
  }

  /** Office admin: their office's settings; super admin: the viewed office's, or the default. */
  @Put("hourly-settings")
  @Roles("ADMIN")
  async putHourlySettings(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const key = await editKeyFor(user);
    if (!key) throw new HttpError(403, "Your account has no office to set hourly settings for");
    // shapes are checked by normalizeHourlyPrefs (unknown values fall back to the defaults)
    const prefs = normalizeHourlyPrefs(await parseBody(req, z.record(z.unknown())));
    const json = prefs as unknown as Prisma.InputJsonValue;
    await prisma.hourlySettings.upsert({
      where: { key },
      create: { key, prefs: json, updatedBy: user.id },
      update: { prefs: json, updatedBy: user.id },
    });
    return settingsView(user);
  }

  /** An office goes back to the default settings ("*" itself cannot be removed). */
  @Delete("hourly-settings")
  @Roles("ADMIN")
  async resetHourlySettings(@CurrentUser() user: AuthUser) {
    const key = await editKeyFor(user);
    if (!key) throw new HttpError(403, "Your account has no office to set hourly settings for");
    if (key !== HOURLY_DEFAULT_KEY) await prisma.hourlySettings.deleteMany({ where: { key } });
    return settingsView(user);
  }

  /** "Hourly Update" mails from Gmail (no download), each with its processing status. */
  @Get("hourly-reports")
  async list(@Req() req: Request) {
    const { from, to, page, pageSize } = parseQuery(req, listQuery);
    const { reports, hasMore } = await hourlySource().list({ from, to, page, pageSize });
    return {
      data: reports.map((r) => ({ ...r, ...hourlyCache.status(r.gmailId) })),
      meta: { page, pageSize, hasMore, cached: hourlyCache.size },
    };
  }

  /** ?a=<older>&b=<newer>[&<filters>] → rows new in b / gone from a (site code + alarm + DN). */
  @Get("hourly-reports/diff")
  async diff(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const sp = searchParams(req);
    const a = sp.get("a");
    const b = sp.get("b");
    if (!a || !b) throw new HttpError(400, "Invalid query", { a: ["required"], b: ["required"] });
    if (a === b) throw new HttpError(400, "Pick two different reports");
    const filters = parseFilters(sp);
    const sort = parseHourlySort(sp.get("sort"));

    const [ra, rb] = await Promise.all([
      getReport(checkGmailId(a), user.role),
      getReport(checkGmailId(b), user.role),
    ]);
    const d = diffHourly(
      filterHourlyRows(await scopeRows(ra.rows, user.id), filters),
      filterHourlyRows(await scopeRows(rb.rows, user.id), filters),
    );
    return {
      data: { new: sortHourlyRows(d.new, sort), disappeared: sortHourlyRows(d.disappeared, sort) },
      meta: { a: ra.meta, b: rb.meta, new: d.new.length, disappeared: d.disappeared.length },
    };
  }

  /** [?force=true] — 202 {status:"processing"} and the work continues in the background; poll
   *  .../status. Already processed (and cached) → 200 {status:"done"} unless force. */
  @Post("hourly-reports/:gmailId/process")
  @Roles("OPERATOR")
  async process(
    @Param("gmailId") gmailId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = checkGmailId(gmailId);
    const force = searchParams(req).get("force") === "true";
    const current = hourlyCache.status(id);
    if (current.status === "done" && !force) {
      res.status(200);
      return { data: current };
    }
    startProcessing(id, force);
    res.status(202);
    return { data: { status: "processing" } };
  }

  /** pending | processing | done (+meta) | failed (+error) */
  @Get("hourly-reports/:gmailId/status")
  status(@Param("gmailId") gmailId: string) {
    return { data: hourlyCache.status(checkGmailId(gmailId)) };
  }

  /** ?sheet&region&office&alarm&siteType&category&vip&from&to&q&sort&page&limit(≤500)[&facets=1]
   *  Served from the cache; re-processed transparently when cold (§14). */
  @Get("hourly-reports/:gmailId/rows")
  async rows(
    @Param("gmailId") gmailId: string,
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
  ) {
    const id = checkGmailId(gmailId);
    const sp = searchParams(req);
    const p = paging.safeParse({
      page: sp.get("page") ?? undefined,
      limit: sp.get("limit") ?? undefined,
    });
    if (!p.success) throw new HttpError(400, "Invalid query", p.error.flatten().fieldErrors);
    const filters = parseFilters(sp);
    const sort = parseHourlySort(sp.get("sort"));

    const report = await getReport(id, user.role);
    const visible = await scopeRows(report.rows, user.id);
    const rows = sortHourlyRows(filterHourlyRows(visible, filters), sort);
    const { page, limit } = p.data;
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      meta: {
        total: rows.length,
        page,
        limit,
        pages: Math.max(1, Math.ceil(rows.length / limit)),
        report: report.meta,
        ...(sp.get("facets") === "1" ? { facets: hourlyFacets(visible) } : {}),
      },
    };
  }

  /** ?<same filters>&sort&columns=a,b,c → .xlsx of the visible table: chosen columns in order.
   *  The office's hourly settings (hourly_settings) apply: hidden alarm types, default sort,
   *  one sheet per category / office group, age colors over the office colors. */
  @Get("hourly-reports/:gmailId/export")
  async export(
    @Param("gmailId") gmailId: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    const id = checkGmailId(gmailId);
    const sp = searchParams(req);
    const filters = parseFilters(sp);
    const [report, info, u] = await Promise.all([
      getReport(id, user.role),
      hourlySource()
        .get(id)
        .catch(() => null),
      getOffice(user.id).then((scope) => getHourlySettings(prisma, scope)),
    ]);
    const prefs = u.prefs;
    const columns = sp.getAll("columns").length ? parseColumns(sp) : prefs.tableColumns;
    const sort = parseHourlySort(sp.get("sort"), hourlySortFor(prefs));

    const visible = visibleHourlyRows(await scopeRows(report.rows, user.id), prefs);
    const rows = sortHourlyRows(filterHourlyRows(visible, filters), sort);
    // age is measured from the time the report mail arrived (wall clock, like Alarm Time)
    const receivedAt = info?.receivedAt ?? report.meta.processedAt;
    const ref = wallClockOf(new Date(receivedAt), process.env.ALARM_TZ || "Africa/Cairo");
    const buf = await buildHourlyXlsx(splitHourlyRows(rows, prefs.split), columns, {
      fill: (r, key) => hourlyCellFill(r, key, ref, prefs),
    });

    const stamp = receivedAt.slice(0, 16).replace(/[:T]/g, "-");
    res
      .status(200)
      .set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="hourly-alarms-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      })
      .end(Buffer.from(buf));
  }

  /** Alarm names seen in processed reports (Settings → Hourly reports hide lists), plus the
   *  state of the "collect from old reports" job. Any signed-in user. */
  @Get("hourly-alarm-names")
  async alarmNames() {
    const data = await prisma.hourlyAlarmName.findMany({
      orderBy: [{ section: "asc" }, { name: "asc" }],
    });
    return { data, meta: { collect: collectState(), collectReports: COLLECT_REPORTS } };
  }

  /** Adds an alarm name by hand (any signed-in user), e.g. one not seen in a report yet, so it can
   *  be hidden ahead of time. {name, section DOWN | ENV} → the saved row (201), or the existing
   *  row unchanged when the name is already there (200). */
  @Post("hourly-alarm-names")
  async addAlarmName(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { name, section } = await parseBody(
      req,
      z.object({
        name: z
          .string()
          .trim()
          .min(1, "name is required")
          .max(200)
          .transform((s) => s.replace(/\s+/g, " ").toUpperCase()),
        section: z.enum(["DOWN", "ENV"]),
      }),
    );
    const existing = await prisma.hourlyAlarmName.findUnique({ where: { name } });
    if (existing) {
      res.status(200); // a POST is 201 by default in Nest
      return { data: existing };
    }
    const data = await prisma.hourlyAlarmName.create({
      data: { name, section, category: section === "DOWN" ? "DOWN" : "OTHER", lastCount: 0 },
    });
    return { data };
  }

  /** Reads the newest reports in the background and saves their alarm names (202). */
  @Post("hourly-alarm-names/collect")
  @Roles("OPERATOR")
  @HttpCode(202)
  collectAlarmNames() {
    return { meta: { collect: startCollect(), collectReports: COLLECT_REPORTS } };
  }

  /** Value fixes applied to hourly reports (§14). */
  @Get("hourly-normalizations")
  @Roles("SUPER_ADMIN")
  async normalizations() {
    return { data: await listNormalizations(), meta: { fields: ["*", ...NORMALIZED_FIELDS] } };
  }

  /** Replaces the whole list and clears the hourly cache. */
  @Put("hourly-normalizations")
  @Roles("SUPER_ADMIN")
  async putNormalizations(@Req() req: Request) {
    const rules = await parseBody(req, z.array(normalizationRule).max(500));
    // (field, from) is unique — keep the last occurrence
    const unique = [
      ...new Map(rules.map((r) => [`${r.field}\u0000${r.from.toUpperCase()}`, r])).values(),
    ];
    await prisma.$transaction([
      prisma.hourlyNormalization.deleteMany(),
      prisma.hourlyNormalization.createMany({ data: unique }),
    ]);
    hourlyCache.clear();
    return { data: await listNormalizations() };
  }
}

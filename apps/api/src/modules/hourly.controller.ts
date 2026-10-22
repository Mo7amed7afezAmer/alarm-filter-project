// Hourly reports (§14, stateless): list from Gmail, process into the in-process cache, read rows,
// export, compare. Plus the normalization rules applied while processing.
import { Controller, Get, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  diffHourly,
  filterHourlyRows,
  hourlyFacets,
  NORMALIZED_FIELDS,
  parseHourlySort,
  sortHourlyRows,
} from "@alarm/core";
import { buildHourlyXlsx } from "@alarm/core/hourly";
import { prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { dateParam, HttpError, parseBody, parseQuery, searchParams } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { hourlySource } from "../lib/gmail.js";
import {
  checkGmailId,
  getReport,
  hourlyCache,
  parseColumns,
  parseFilters,
  scopeRows,
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

@Controller()
export class HourlyController {
  /** "Hourly Update" mails from Gmail (no download), each with its processing status. */
  @Get("hourly-reports")
  async list(@Req() req: Request) {
    const { from, to, page } = parseQuery(req, listQuery);
    const { reports, hasMore } = await hourlySource().list({ from, to, page, pageSize: PAGE_SIZE });
    return {
      data: reports.map((r) => ({ ...r, ...hourlyCache.status(r.gmailId) })),
      meta: { page, pageSize: PAGE_SIZE, hasMore, cached: hourlyCache.size },
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
    const p = paging.safeParse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
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

  /** ?<same filters>&sort&columns=a,b,c → .xlsx of the visible table: chosen columns in order,
   *  office row colors, frozen header, autofilter. */
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
    const columns = parseColumns(sp);
    const sort = parseHourlySort(sp.get("sort"));

    const report = await getReport(id, user.role);
    const visible = await scopeRows(report.rows, user.id);
    const rows = sortHourlyRows(filterHourlyRows(visible, filters), sort);
    const buf = await buildHourlyXlsx(rows, columns);

    const info = await hourlySource()
      .get(id)
      .catch(() => null);
    const stamp = (info?.receivedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-");
    res
      .status(200)
      .set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="hourly-alarms-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      })
      .end(Buffer.from(buf));
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
    const unique = [...new Map(rules.map((r) => [`${r.field}\u0000${r.from.toUpperCase()}`, r])).values()];
    await prisma.$transaction([
      prisma.hourlyNormalization.deleteMany(),
      prisma.hourlyNormalization.createMany({ data: unique }),
    ]);
    hourlyCache.clear();
    return { data: await listNormalizations() };
  }
}

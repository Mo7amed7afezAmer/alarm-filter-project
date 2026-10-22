// Site Master (§14): reference data joined into hourly reports and alarm pages.
import { Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { baseNormalize } from "@alarm/core";
import { HourlyReportError, parseSiteMasterXlsx } from "@alarm/core/hourly";
import { prisma, resolveOffices, unmappedSiteMasterOffices, type Prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { HttpError, pagination, parseBody, parseQuery, readForm } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { hourlyCache } from "../lib/hourly.js";
import { getOffice, sameOffice } from "../lib/office.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const listQuery = z.object({
  office: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  ...pagination,
});

const text = z
  .string()
  .trim()
  .max(200)
  .transform((s) => s || null)
  .nullable();

const editBody = z
  .object({
    siteName: text,
    office: z.string().trim().min(1, "office is required").max(100).transform(baseNormalize),
    nodality: text,
    vip: z.boolean(),
    siteType: text,
    powerSource: text,
    battery: text,
    phone: z
      .string()
      .trim()
      .max(100)
      .regex(/^[\d+ /()-]*$/, "digits only (several numbers separated by /)")
      .transform((s) => s || null)
      .nullable(),
    notes: z.string().trim().max(1000).transform((s) => s || null).nullable(),
  })
  .partial()
  .strict();

@Controller("site-master")
export class SiteMasterController {
  /** ?office&q&page&pageSize — any signed-in user (read-only reference data). Office users see
   *  only the sites of their own office (Site Master office ↔ office label by name). */
  @Get()
  async list(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { office, q, page, pageSize } = parseQuery(req, listQuery);
    const scope = await getOffice(user.id);
    const allOffices = await prisma.siteMaster.groupBy({
      by: ["office"],
      _count: { _all: true },
      orderBy: { office: "asc" },
    });
    const offices =
      scope === null ? allOffices : allOffices.filter((o) => sameOffice(o.office, scope));
    const where: Prisma.SiteMasterWhereInput = {
      AND: [
        scope === null ? {} : { office: { in: offices.map((o) => o.office) } },
        office ? { office } : {},
      ],
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { siteName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.siteMaster.findMany({
        where,
        orderBy: [{ office: "asc" }, { code: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.siteMaster.count({ where }),
    ]);
    return {
      data: items,
      meta: {
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        offices: offices.map((o) => ({ office: o.office, count: o._count._all })),
      },
    };
  }

  /** Multipart field "file" (.xlsx) → upsert by Code. Clears the hourly cache (enrichment
   *  changed) and re-resolves the office of every alarm (site code → Site Master office). */
  @Post("import")
  @Roles("SUPER_ADMIN")
  @HttpCode(200)
  async import(@Req() req: Request) {
    let form: FormData;
    try {
      form = await readForm(req);
    } catch {
      throw new HttpError(400, "Send multipart/form-data with a 'file' field");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "Missing 'file'");
    if (!/\.xlsx$/i.test(file.name)) throw new HttpError(400, "Upload an .xlsx file");
    if (file.size > MAX_IMPORT_BYTES) throw new HttpError(413, "File too large (max 5 MB)");

    let parsed;
    try {
      parsed = await parseSiteMasterXlsx(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      if (err instanceof HourlyReportError) throw new HttpError(422, err.message);
      throw err;
    }

    const existing = new Set(
      (
        await prisma.siteMaster.findMany({
          where: { code: { in: parsed.rows.map((r) => r.code) } },
          select: { code: true },
        })
      ).map((r) => r.code),
    );
    await prisma.$transaction(
      parsed.rows.map(({ code, ...rest }) =>
        prisma.siteMaster.upsert({ where: { code }, create: { code, ...rest }, update: rest }),
      ),
    );
    hourlyCache.clear();
    const resolved = await resolveOffices(prisma);

    const updated = parsed.rows.filter((r) => existing.has(r.code)).length;
    return {
      data: {
        inserted: parsed.rows.length - updated,
        updated,
        skipped: parsed.skipped,
        /** Alarms / orphan clears whose office changed. */
        reassigned: resolved.alarms + resolved.orphans,
        /** Site Master office names with no matching Gmail office label (alarms keep the mail label). */
        unmappedOffices: await unmappedSiteMasterOffices(prisma),
      },
      meta: { fileName: file.name },
    };
  }

  /** Inline edit of one site. */
  @Put(":code")
  @Roles("SUPER_ADMIN")
  async update(@Param("code") rawCode: string, @Req() req: Request) {
    const code = rawCode.trim().toUpperCase();
    const data = await parseBody(req, editBody);
    if (!(await prisma.siteMaster.findUnique({ where: { code } })))
      throw new HttpError(404, `Site ${code} not found`);
    const site = await prisma.siteMaster.update({ where: { code }, data });
    hourlyCache.clear();
    if (data.office) await resolveOffices(prisma); // alarms of this site may move office
    return { data: site };
  }
}

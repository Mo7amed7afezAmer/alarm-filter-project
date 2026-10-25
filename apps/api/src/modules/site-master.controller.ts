// Site Master (§14): reference data joined into hourly reports and alarm pages, and the
// /site-master page (list for everyone in their office scope; add / edit / delete / import for
// admins — the office admin only for the sites of their own office).
import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { BATTERY_NONE, BATTERY_WEAK, baseNormalize, hasGenerator } from "@alarm/core";
import {
  HourlyReportError,
  parseSiteMasterXlsx,
  phoneText,
  regionOf,
  SITE_CODE_RE,
  type SiteMasterInput,
} from "@alarm/core/hourly";
import { prisma, resolveOffices, unmappedSiteMasterOffices, type Prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { HttpError, pagination, parseBody, parseQuery, readForm } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { hourlyCache } from "../lib/hourly.js";
import { getOffice, sameOffice } from "../lib/office.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const yesNo = z.enum(["yes", "no"]).optional();

const listQuery = z.object({
  office: z.string().trim().max(100).optional(),
  /** Code, site name, phone or location. */
  q: z.string().trim().max(100).optional(),
  vip: yesNo,
  /** Nodal = any nodality except 1+0. */
  nodal: yesNo,
  /** Power source with our own generator (DG / GEN / HGB, not another company's). */
  generator: yesNo,
  /** yes = batteries present (not none / stolen / faulty / weak). */
  battery: yesNo,
  siteType: z.string().trim().max(100).optional(),
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
      .transform((s) => phoneText(s))
      .nullable(),
    location: z
      .string()
      .trim()
      .max(500)
      .transform((s) => s || null)
      .nullable(),
    notes: z
      .string()
      .trim()
      .max(1000)
      .transform((s) => s || null)
      .nullable(),
  })
  .partial()
  .strict();

const createBody = editBody.required({ office: true }).extend({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => SITE_CODE_RE.test(s), "invalid site code (e.g. 0H31DE)"),
});

const TEMPLATE_COLUMNS = [
  "Code",
  "Site Name",
  "Office",
  "Nodality",
  "VIP",
  "Site type",
  "Power Source",
  "Battery",
  "Guard Number",
  "Location",
  "Notes",
];

/** Office scope for managing sites: null = every site (super admin). */
async function manageScope(user: AuthUser): Promise<string | null> {
  if (user.role === "SUPER_ADMIN") return null;
  return (await getOffice(user.id)) ?? "";
}

function assertInScope(scope: string | null, siteOffice: string) {
  if (scope !== null && !(scope && sameOffice(siteOffice, scope)))
    throw new HttpError(403, "You can only manage the sites of your own office");
}

/** A site the user may see; out-of-scope sites are reported as missing, like the list hides them. */
async function findSite(user: AuthUser, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const site = await prisma.siteMaster.findUnique({ where: { code } });
  const scope = await getOffice(user.id);
  if (!site || (scope !== null && !sameOffice(site.office, scope)))
    throw new HttpError(404, `Site ${code} not found`);
  return site;
}

/** Enrichment changed: hourly reports re-process; alarms may move office. */
async function siteMasterChanged(officeChanged: boolean) {
  hourlyCache.clear();
  if (officeChanged) await resolveOffices(prisma);
}

const contains = (field: "battery" | "powerSource", w: string): Prisma.SiteMasterWhereInput => ({
  [field]: { contains: w, mode: "insensitive" },
});

@Controller("site-master")
export class SiteMasterController {
  /** ?office&q&vip&nodal&generator&battery&siteType&page&pageSize — any signed-in user.
   *  Office users see only the sites of their own office (Site Master office ↔ office label). */
  @Get()
  async list(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { office, q, vip, nodal, generator, battery, siteType, page, pageSize } = parseQuery(
      req,
      listQuery,
    );
    const scope = await getOffice(user.id);
    const allOffices = await prisma.siteMaster.groupBy({
      by: ["office"],
      _count: { _all: true },
      orderBy: { office: "asc" },
    });
    const offices =
      scope === null ? allOffices : allOffices.filter((o) => sameOffice(o.office, scope));
    const inScope: Prisma.SiteMasterWhereInput =
      scope === null ? {} : { office: { in: offices.map((o) => o.office) } };

    const and: Prisma.SiteMasterWhereInput[] = [inScope];
    if (office) and.push({ office });
    if (q)
      and.push({
        OR: (["code", "siteName", "phone", "location"] as const).map((f) => ({
          [f]: { contains: q, mode: "insensitive" },
        })),
      });
    if (vip) and.push({ vip: vip === "yes" });
    if (nodal) {
      const notNodal: Prisma.SiteMasterWhereInput = {
        OR: [{ nodality: null }, { nodality: "" }, { nodality: "1+0" }],
      };
      and.push(nodal === "yes" ? { NOT: notNodal } : notNodal);
    }
    if (generator) {
      // hasGenerator(): DG / GEN / HGB, but not another company's power ("DG/VF", "ETDG").
      const withPower = await prisma.siteMaster.findMany({
        where: { powerSource: { not: null } },
        select: { code: true, powerSource: true },
      });
      const codes = withPower.filter((s) => hasGenerator(s.powerSource)).map((s) => s.code);
      and.push(generator === "yes" ? { code: { in: codes } } : { code: { notIn: codes } });
    }
    if (battery) {
      const bad: Prisma.SiteMasterWhereInput = {
        OR: [
          { battery: { equals: "NO", mode: "insensitive" } },
          ...[...BATTERY_NONE, ...BATTERY_WEAK].map((w) => contains("battery", w)),
        ],
      };
      and.push(
        battery === "yes"
          ? { AND: [{ battery: { not: null } }, { NOT: { battery: "" } }, { NOT: bad }] }
          : { OR: [{ battery: null }, { battery: "" }, bad] },
      );
    }
    if (siteType) and.push({ siteType });
    const where: Prisma.SiteMasterWhereInput = { AND: and };

    const [items, total, types] = await Promise.all([
      prisma.siteMaster.findMany({
        where,
        orderBy: [{ office: "asc" }, { code: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.siteMaster.count({ where }),
      prisma.siteMaster.findMany({
        where: { AND: [inScope, { siteType: { not: null } }] },
        distinct: ["siteType"],
        select: { siteType: true },
        orderBy: { siteType: "asc" },
      }),
    ]);
    const mine = await manageScope(user);
    return {
      data: items,
      meta: {
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        offices: offices.map((o) => ({ office: o.office, count: o._count._all })),
        siteTypes: types.map((t) => t.siteType).filter((t): t is string => !!t),
        /** Can the user add / edit / delete / import (in their scope)? */
        canManage: user.role === "SUPER_ADMIN" || (user.role === "ADMIN" && !!mine),
      },
    };
  }

  /** Empty import file with the column headers (sheet "SiteMaster") and one example row. */
  @Get("template")
  @Roles("ADMIN")
  async template(@Res() res: Response) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("SiteMaster");
    ws.columns = TEMPLATE_COLUMNS.map((h) => ({
      header: h,
      key: h,
      width: Math.max(12, h.length + 4),
    }));
    ws.addRow({
      Code: "0H31DE",
      "Site Name": "BH-QMB-LOQIN",
      Office: "KAFR EL DAWAR",
      Nodality: "1+0",
      VIP: "NO",
      "Site type": "End Point",
      "Power Source": "EC+DG",
      Battery: "YES",
      "Guard Number": "01012345678",
      Location: "31.0412, 30.4702",
    });
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    res
      .status(200)
      .set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="SiteMaster-template.xlsx"',
      })
      .end(Buffer.from(buf));
  }

  /** Add one site (the "Add site" window). */
  @Post()
  @Roles("ADMIN")
  @HttpCode(201)
  async create(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const { code, ...data } = await parseBody(req, createBody);
    assertInScope(await manageScope(user), data.office);
    if (await prisma.siteMaster.findUnique({ where: { code } }))
      throw new HttpError(409, `Site ${code} already exists`);
    const site = await prisma.siteMaster.create({
      data: { code, ...data, vip: data.vip ?? false, region: regionOf(code) || null },
    });
    await siteMasterChanged(true);
    return { data: site };
  }

  /** Multipart field "file" (.xlsx) → upsert by Code, writing only the columns the file has
   *  (a file without phones keeps the stored phones). Generator sheets patch the power source.
   *  Office admins: rows of other offices are skipped. Clears the hourly cache and re-resolves
   *  the office of every alarm (site code → Site Master office). */
  @Post("import")
  @Roles("ADMIN")
  @HttpCode(200)
  async import(@Req() req: Request, @CurrentUser() user: AuthUser) {
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
    const { columns, skipped } = parsed;
    let rows = parsed.rows;

    const stored = new Map(
      (
        await prisma.siteMaster.findMany({
          where: {
            code: { in: [...rows.map((r) => r.code), ...parsed.patches.map((p) => p.code)] },
          },
          select: { code: true, office: true },
        })
      ).map((r) => [r.code, r.office]),
    );

    // Office admins: only their office's rows, and never a code stored under another office.
    const scope = await manageScope(user);
    const inScope = (office: string) => scope === null || (!!scope && sameOffice(office, scope));
    if (scope !== null) {
      for (const r of rows) {
        if (!inScope(r.office))
          skipped.push({ row: 0, code: r.code, reason: `office ${r.office} is not your office` });
        else if (stored.has(r.code) && !inScope(stored.get(r.code)!))
          skipped.push({ row: 0, code: r.code, reason: "code belongs to another office" });
      }
      rows = rows.filter(
        (r) => inScope(r.office) && (!stored.has(r.code) || inScope(stored.get(r.code)!)),
      );
    }

    const pick = (r: SiteMasterInput) =>
      Object.fromEntries(columns.map((c) => [c, r[c]])) as Partial<SiteMasterInput>;
    await prisma.$transaction(
      rows.map((r) =>
        prisma.siteMaster.upsert({
          where: { code: r.code },
          create: r,
          update: { ...pick(r), region: r.region },
        }),
      ),
    );

    // Power source from the generator sheets: sites of this file or already stored, in scope.
    const known = new Map([...stored, ...rows.map((r) => [r.code, r.office] as const)]);
    const patches = parsed.patches.filter((p) => known.has(p.code) && inScope(known.get(p.code)!));
    await prisma.$transaction(
      patches.map((p) =>
        prisma.siteMaster.update({ where: { code: p.code }, data: { powerSource: p.powerSource } }),
      ),
    );

    hourlyCache.clear();
    const resolved = await resolveOffices(prisma);
    const updated = rows.filter((r) => stored.has(r.code)).length;
    return {
      data: {
        inserted: rows.length - updated,
        updated,
        skipped,
        /** Power source set from the generator sheets. */
        powerUpdated: patches.length,
        /** Generator-sheet codes that are not Site Master sites. */
        powerUnknown: parsed.patches.length - patches.length,
        dismantled: parsed.dismantled.length,
        columns,
        /** Alarms / orphan clears whose office changed. */
        reassigned: resolved.alarms + resolved.orphans,
        /** Site Master office names with no matching Gmail office label (alarms keep the mail label). */
        unmappedOffices: await unmappedSiteMasterOffices(prisma),
      },
      meta: { fileName: file.name },
    };
  }

  /** Edit one site (the "Edit" window, or inline cells). */
  @Put(":code")
  @Roles("ADMIN")
  async update(@Param("code") rawCode: string, @Req() req: Request, @CurrentUser() user: AuthUser) {
    const current = await findSite(user, rawCode);
    const data = await parseBody(req, editBody);
    const scope = await manageScope(user);
    assertInScope(scope, current.office);
    if (data.office) assertInScope(scope, data.office); // cannot move it to another office
    const site = await prisma.siteMaster.update({ where: { code: current.code }, data });
    await siteMasterChanged(!!data.office && data.office !== current.office);
    return { data: site };
  }

  @Delete(":code")
  @Roles("ADMIN")
  async remove(@Param("code") rawCode: string, @CurrentUser() user: AuthUser) {
    const current = await findSite(user, rawCode);
    assertInScope(await manageScope(user), current.office);
    await prisma.siteMaster.delete({ where: { code: current.code } });
    await siteMasterChanged(true); // its alarms fall back to the mail office
    return { data: { code: current.code } };
  }
}

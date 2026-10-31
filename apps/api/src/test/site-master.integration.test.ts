// HTTP tests for the /site-master page API against the separate alarms_test database: office
// scope of the list, add / edit / delete per role, and imports that keep columns the file lacks.
// Touches only site_master rows with ZT* codes and removes them afterwards.
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./harness.js";

const url = process.env.TEST_DATABASE_URL;
const api = createHarness();
const PREFIX = "ZZ-SITEMASTERTEST";
const OFFICE = "DN/Kafr ElDawar"; // office users' label ↔ Site Master "KAFR EL DAWAR"
let users: import("./test-users.js").TestUsers;
const as = (role: keyof typeof users) => (api.session.current = { user: { id: users[role] } });
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const codes = (r: { body: { data: { code: string }[] } }) => r.body.data.map((s) => s.code);

async function xlsx(sheets: Record<string, (string | number)[][]>): Promise<FormData> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(await wb.xlsx.writeBuffer())], "sites.xlsx"));
  return fd;
}

describe.skipIf(!url)("site master page API", () => {
  let prisma: typeof import("@alarm/db").prisma;
  const clean = () => prisma.siteMaster.deleteMany({ where: { code: { startsWith: "ZT" } } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    await api.start();
    users = await (await import("./test-users.js")).createTestUsers(prisma, PREFIX, OFFICE);
    await clean();
    await prisma.siteMaster.createMany({
      data: [
        {
          code: "ZT01DE",
          office: "KAFR EL DAWAR",
          nodality: "1+0",
          phone: "01012345678",
          region: "DE",
        },
        {
          code: "ZT02DE",
          office: "KAFR EL DAWAR",
          nodality: "1+3",
          vip: true,
          powerSource: "EC+DG",
          battery: "Faulty Batteries",
          region: "DE",
        },
        { code: "ZT03DE", office: "TANTA", nodality: "1+0", battery: "YES", region: "DE" },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await clean();
    await (await import("./test-users.js")).removeTestUsers(prisma, PREFIX);
    await api.stop();
  });

  it("lists only the office of the user, with flag filters; viewers cannot manage", async () => {
    as("VIEWER");
    const mine = await api.call("/api/site-master?q=ZT");
    expect(codes(mine)).toEqual(["ZT01DE", "ZT02DE"]);
    expect(mine.body.meta.canManage).toBe(false);
    expect(codes(await api.call("/api/site-master?q=ZT&nodal=yes"))).toEqual(["ZT02DE"]);
    expect(codes(await api.call("/api/site-master?q=ZT&battery=no"))).toEqual(["ZT01DE", "ZT02DE"]);
    expect(codes(await api.call("/api/site-master?q=ZT&generator=yes&vip=yes"))).toEqual([
      "ZT02DE",
    ]);
    expect(codes(await api.call("/api/site-master?q=0101234"))).toEqual(["ZT01DE"]); // by phone
    expect(
      (
        await api.call(
          "/api/site-master",
          json("POST", { code: "ZT09DE", office: "KAFR EL DAWAR" }),
        )
      ).status,
    ).toBe(403);

    as("SUPER_ADMIN");
    const all = await api.call("/api/site-master?q=ZT");
    expect(codes(all)).toHaveLength(3);
    expect(all.body.meta.canManage).toBe(true);
  });

  it("office admin adds, edits and deletes only sites of their own office", async () => {
    as("ADMIN");
    expect((await api.call("/api/site-master?q=ZT")).body.meta.canManage).toBe(true);
    const add = await api.call(
      "/api/site-master",
      json("POST", {
        code: "zt04de",
        office: "KAFR EL DAWAR",
        phone: "1098765432",
        location: "31.04, 30.47",
      }),
    );
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({
      code: "ZT04DE",
      phone: "01098765432",
      region: "DE",
      vip: false,
    });
    const again = await api.call(
      "/api/site-master",
      json("POST", { code: "ZT04DE", office: "KAFR EL DAWAR" }),
    );
    expect(again.status).toBe(409);
    expect(
      (await api.call("/api/site-master", json("POST", { code: "ZT05DE", office: "TANTA" })))
        .status,
    ).toBe(403);
    const bad = await api.call(
      "/api/site-master",
      json("POST", { code: "bad code", office: "KAFR EL DAWAR" }),
    );
    expect(bad.status).toBe(400);

    const put = await api.call("/api/site-master/ZT04DE", json("PUT", { siteName: "BH-NEW" }));
    expect(put.body.data.siteName).toBe("BH-NEW");
    expect(
      (await api.call("/api/site-master/ZT04DE", json("PUT", { office: "TANTA" }))).status,
    ).toBe(403);
    // A site of another office is invisible to the office admin.
    expect((await api.call("/api/site-master/ZT03DE", json("PUT", { siteName: "x" }))).status).toBe(
      404,
    );
    expect((await api.call("/api/site-master/ZT03DE", { method: "DELETE" })).status).toBe(404);

    as("OPERATOR");
    expect((await api.call("/api/site-master/ZT04DE", { method: "DELETE" })).status).toBe(403);
    as("ADMIN");
    expect((await api.call("/api/site-master/ZT04DE", { method: "DELETE" })).status).toBe(200);
    expect(await prisma.siteMaster.findUnique({ where: { code: "ZT04DE" } })).toBeNull();
  });

  it("import updates only the columns of the file, applies generator sheets, skips dismantled and other offices", async () => {
    const file = () =>
      xlsx({
        Sites: [
          [
            "Site Code",
            "Site Name",
            "SC Office",
            "Nodal Deg.",
            "Cascade Type",
            "VIP",
            "Battaries Status",
          ],
          ["ZT01DE", "BH-ONE", "KAFR EL DAWAR", 2, "Nodal", "Yes", "No Batteries - D9"],
          ["ZT06DE", "BH-SIX", "KAFR EL DAWAR", 1, "End Point", "No", ""],
          ["ZT07DE", "TA-SEVEN", "TANTA", 1, "End Point", "No", ""],
          ["ZT08DE", "BH-GONE", "KAFR EL DAWAR", 1, "End Point", "No", ""],
        ],
        "OR GEN Sites": [
          ["Site Code", "Site Name", "Power Configuration"],
          ["ZT01DE", "BH-ONE", "HGB"],
          ["ZT03DE", "TA-THREE", "DG"],
        ],
        "Dismantle ": [["Short Code"], ["ZT08DE"]],
      });

    as("ADMIN"); // office admin: TANTA rows and sites are not theirs
    const r = await api.call("/api/site-master/import", { method: "POST", body: await file() });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ inserted: 1, updated: 1, powerUpdated: 1, dismantled: 1 });
    expect(r.body.data.skipped.map((s: { code: string }) => s.code).sort()).toEqual([
      "ZT07DE",
      "ZT08DE",
    ]);
    // Updated from the file; the phone (no such column in the file) is kept.
    expect(await prisma.siteMaster.findUnique({ where: { code: "ZT01DE" } })).toMatchObject({
      siteName: "BH-ONE",
      nodality: "1+1",
      siteType: "Nodal",
      vip: true,
      battery: "No Batteries - D9",
      powerSource: "HGB",
      phone: "01012345678",
    });
    expect(await prisma.siteMaster.findUnique({ where: { code: "ZT03DE" } })).toMatchObject({
      powerSource: null,
    });
    expect(await prisma.siteMaster.findUnique({ where: { code: "ZT07DE" } })).toBeNull();

    as("SUPER_ADMIN");
    const all = await api.call("/api/site-master/import", { method: "POST", body: await file() });
    expect(all.body.data).toMatchObject({ inserted: 1, updated: 2, powerUpdated: 2 });
    expect(await prisma.siteMaster.findUnique({ where: { code: "ZT03DE" } })).toMatchObject({
      powerSource: "DG",
    });
  });

  it("saves the alarm Mail view choice in the personal UI settings", async () => {
    as("VIEWER");
    const { prefs } = (await api.call("/api/me/ui-prefs")).body;
    const put = await api.call(
      "/api/me/ui-prefs",
      json("PUT", { ...prefs, alarms: { ...prefs.alarms, view: "mail" } }),
    );
    expect(put.body.prefs.alarms.view).toBe("mail");
    expect((await api.call("/api/me/ui-prefs")).body.prefs.alarms.view).toBe("mail");
  });

  it("saves the Export image settings (columns, sort, office colours, share chats)", async () => {
    as("VIEWER");
    const { prefs } = (await api.call("/api/me/ui-prefs")).body;
    const image = {
      columns: ["time", "vip", "nodal"],
      byOffice: true,
      rowsPerImage: 60,
      sort: "down",
      officeColors: { "Kafr ElDawar": "#BBF7D0" },
      shareAll: "https://chat.whatsapp.com/AbCdEfGhIj1234567890",
      shareOffices: { "Kafr ElDawar": "01012345678" },
      shareMode: "office",
    };
    await api.call(
      "/api/me/ui-prefs",
      json("PUT", { ...prefs, alarms: { ...prefs.alarms, image } }),
    );
    expect((await api.call("/api/me/ui-prefs")).body.prefs.alarms.image).toEqual({
      ...image,
      columns: ["time", "site", "vip", "nodal"],
      officeColors: { "Kafr ElDawar": "#bbf7d0" },
      shareOffices: { "Kafr ElDawar": "201012345678" },
    });
  });

  it("serves the import template to admins", async () => {
    as("ADMIN");
    const t = await api.call("/api/site-master/template");
    expect(t.status).toBe(200);
    expect(t.headers.get("content-disposition")).toContain("SiteMaster-template.xlsx");
  });
});

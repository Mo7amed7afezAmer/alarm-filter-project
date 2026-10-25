// Integration tests: the real Nest app (over HTTP) against the compose Postgres.
// Runs only when TEST_DATABASE_URL is set. Inserts rows under site prefix ZZ-APITEST and
// deletes exactly those afterwards — real data is never touched.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./harness.js";

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "ZZ-APITEST";
const OFFICE = "ZZ/ApiTest";

const api = createHarness();
const session = api.session;

type Prisma = typeof import("@alarm/db").prisma;

describe.skipIf(!url)("API integration", () => {
  let prisma: Prisma;
  let users: import("./test-users.js").TestUsers;
  /** Signed in as the test account with this role (office OFFICE; super admin: all). */
  const as = (role: keyof typeof users) => (session.current = { user: { id: users[role] } });

  const get = api.get;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    await api.start();
    const { createTestUsers } = await import("./test-users.js");
    users = await createTestUsers(prisma, PREFIX, OFFICE);

    await prisma.alarm.deleteMany({ where: { site: { startsWith: PREFIX } } });
    const h = 3_600_000;
    const now = Date.now();
    const base = {
      status: "ACTIVE" as const,
      clearTime: null,
      durationMin: null,
      clearType: null,
      office: OFFICE,
    };
    await prisma.alarm.createMany({
      data: [
        {
          ...base,
          alarmKey: `LINK FAILURE||${PREFIX}-A`,
          alarmName: "S_D_N_BTS O&M LINK FAILURE",
          site: `${PREFIX}-A`,
          category: "DOWN",
          alarmTime: new Date(now - 10 * h),
        },
        {
          ...base,
          alarmKey: `RECTIFIER||${PREFIX}-B`,
          alarmName: "S_D_N_RECTIFIER MAJOR ALARM",
          site: `${PREFIX}-B`,
          category: "POWER",
          alarmTime: new Date(now - 1 * h),
        },
        {
          alarmKey: `LINK FAILURE||${PREFIX}-C`,
          alarmName: "S_D_N_BTS O&M LINK FAILURE",
          site: `${PREFIX}-C`,
          category: "DOWN",
          alarmTime: new Date(now - 2 * h),
          status: "CLEARED",
          clearTime: new Date(now - 1.5 * h),
          durationMin: 30,
          clearType: "EMAIL",
          office: OFFICE,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.alarm.deleteMany({ where: { site: { startsWith: PREFIX } } });
    const { removeTestUsers } = await import("./test-users.js");
    await removeTestUsers(prisma, PREFIX);
    await api.stop();
    await prisma.$disconnect();
  });

  describe("auth (mobile Bearer token, web session cookie)", () => {
    const EMAIL = `${PREFIX.toLowerCase()}-login@test.local`;
    beforeAll(async () => {
      const bcrypt = (await import("bcryptjs")).default;
      await prisma.user.deleteMany({ where: { email: EMAIL } });
      await prisma.user.create({
        data: { email: EMAIL, passwordHash: await bcrypt.hash("password1", 4), office: OFFICE },
      });
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: EMAIL } });
    });

    it("POST /api/auth/token: valid credentials → Bearer token that works; wrong → 401", async () => {
      session.current = null;
      const bad = await api.call("/api/auth/token", {
        method: "POST",
        json: { email: EMAIL, password: "wrong-password" },
      });
      expect(bad.status).toBe(401);

      const ok = await api.call("/api/auth/token", {
        method: "POST",
        json: { email: EMAIL.toUpperCase(), password: "password1" },
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        tokenType: "Bearer",
        user: { email: EMAIL, role: "VIEWER", office: OFFICE },
      });
      const auth = { authorization: `Bearer ${ok.body.token}` };

      const me = await api.call("/api/me", { headers: auth });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ user: { email: EMAIL }, office: OFFICE });
      const list = await api.call(`/api/alarms/active?site=${PREFIX}`, { headers: auth });
      expect(list.body.total).toBe(2);

      expect(
        (await api.call("/api/me", { headers: { authorization: "Bearer nope" } })).status,
      ).toBe(401);
    });

    it("accepts the NextAuth session cookie the web pages send", async () => {
      session.current = null;
      const { encode } = await import("next-auth/jwt");
      const id = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
      const token = await encode({
        token: { sub: String(id), email: EMAIL, role: "VIEWER" },
        secret: process.env.NEXTAUTH_SECRET!,
      });
      const r = await api.call("/api/me", {
        headers: { cookie: `next-auth.session-token=${token}` },
      });
      expect(r.status).toBe(200);
      expect(r.body.user.email).toBe(EMAIL);

      const forged = await encode({ token: { sub: String(id) }, secret: "some-other-secret" });
      const f = await api.call("/api/me", {
        headers: { cookie: `next-auth.session-token=${forged}` },
      });
      expect(f.status).toBe(401);
    });

    it("unknown routes are JSON 404s; health is public", async () => {
      session.current = null;
      expect((await api.call("/api/nope")).status).toBe(404);
      const h = await api.call("/api/health");
      expect(h.status).toBe(200);
      expect(h.body).toMatchObject({ ok: true, db: "ok" });
    });
  });

  describe("GET /api/alarms/active", () => {
    it("401 without a session", async () => {
      session.current = null;
      expect((await get("/api/alarms/active")).status).toBe(401);
    });

    it("lists only ACTIVE alarms, filtered by site, newest first, paginated", async () => {
      as("VIEWER");
      const { status, body } = await get(`/api/alarms/active?site=${PREFIX}`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ total: 2, page: 1, pageSize: 50, pages: 1 });
      expect(body.items.map((a: { site: string }) => a.site)).toEqual([
        `${PREFIX}-B`,
        `${PREFIX}-A`,
      ]);
      expect(body.items[0]).toMatchObject({ category: "POWER", status: "ACTIVE", region: null });
    });

    it("filters by category and minHours", async () => {
      as("VIEWER");
      const byCat = await get(`/api/alarms/active?site=${PREFIX}&category=DOWN`);
      expect(byCat.body.items.map((a: { site: string }) => a.site)).toEqual([`${PREFIX}-A`]);
      const old = await get(`/api/alarms/active?site=${PREFIX}&minHours=4`);
      expect(old.body.total).toBe(1);
      expect(old.body.items[0].site).toBe(`${PREFIX}-A`);
    });

    it("paginates", async () => {
      as("VIEWER");
      const p2 = await get(`/api/alarms/active?site=${PREFIX}&pageSize=1&page=2`);
      expect(p2.body).toMatchObject({ total: 2, pages: 2, page: 2 });
      expect(p2.body.items).toHaveLength(1);
    });

    it("adds VIP / nodality / battery / phone from Site Master (code = last _ segment)", async () => {
      as("VIEWER");
      const site = "SMJOIN_LWG_S_BH-TEST_9Z98ZT";
      await prisma.siteMaster.upsert({
        where: { code: "9Z98ZT" },
        create: {
          code: "9Z98ZT",
          office: "TEST",
          vip: true,
          nodality: "1+3",
          battery: "YES",
          phone: "01012345678",
        },
        update: { vip: true, nodality: "1+3", battery: "YES", phone: "01012345678" },
      });
      await prisma.alarm.create({
        data: {
          alarmKey: `X||${site}`,
          alarmName: "S_D_N_X",
          site,
          category: "OTHER",
          alarmTime: new Date(),
          status: "ACTIVE",
          office: OFFICE,
        },
      });
      try {
        const { body } = await get("/api/alarms/active?site=SMJOIN");
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          siteCode: "9Z98ZT",
          vip: true,
          nodality: "1+3",
          battery: "YES",
          phone: "01012345678",
        });
      } finally {
        await prisma.alarm.deleteMany({ where: { site } });
        await prisma.siteMaster.delete({ where: { code: "9Z98ZT" } });
      }
    });

    it("search, site tags, category counts (tabs) and the super admin's office filter", async () => {
      const sites = { gen: `TAGS_S_BH-GEN_9Z97ZT`, vf: `TAGS_S_BH-VF_9Z96ZT` };
      await prisma.siteMaster.createMany({
        data: [
          { code: "9Z97ZT", office: "TEST", vip: true, nodality: "1+0", powerSource: "EC+DG" },
          { code: "9Z96ZT", office: "TEST", vip: false, nodality: "1+2", powerSource: "DG/VF" },
        ],
      });
      await prisma.alarm.createMany({
        data: [
          {
            site: sites.gen,
            siteCode: "9Z97ZT",
            category: "DOWN" as const,
            cellName: "CELL_TAGS_1",
          },
          { site: sites.vf, siteCode: "9Z96ZT", category: "POWER" as const, cellName: null },
        ].map((a) => ({
          ...a,
          alarmKey: `X||${a.site}`,
          alarmName: "S_D_N_TAGS",
          alarmTime: new Date(),
          status: "ACTIVE" as const,
          office: OFFICE,
        })),
      });
      const sitesOf = (body: { items: { site: string }[] }) => body.items.map((a) => a.site).sort();
      try {
        as("VIEWER");
        const all = await get("/api/alarms/active?q=tags_s_bh");
        expect(all.body.total).toBe(2);
        expect(all.body.categories).toEqual({ DOWN: 1, POWER: 1 });
        expect(all.body.offices).toEqual([]); // office users get no office filter
        expect(sitesOf((await get("/api/alarms/active?q=cell_tags")).body)).toEqual([sites.gen]);
        expect(sitesOf((await get("/api/alarms/active?q=9Z96ZT")).body)).toEqual([sites.vf]);

        const tag = async (flag: string) =>
          sitesOf((await get(`/api/alarms/active?q=TAGS_S_BH&flag=${flag}`)).body);
        expect(await tag("vip")).toEqual([sites.gen]);
        expect(await tag("nodal")).toEqual([sites.vf]);
        // DG/VF = another company's generator → not a generator site.
        expect(await tag("generator")).toEqual([sites.gen]);
        expect((await get("/api/alarms/active?flag=solar")).status).toBe(400);

        // The tab counts ignore the selected category.
        const down = await get("/api/alarms/active?q=TAGS_S_BH&category=DOWN");
        expect(down.body.total).toBe(1);
        expect(down.body.categories).toEqual({ DOWN: 1, POWER: 1 });

        // Office filter: only for the super admin viewing all offices; ignored for others.
        expect((await get(`/api/alarms/active?q=TAGS_S_BH&office=ZZ/Other`)).body.total).toBe(2);
        as("SUPER_ADMIN");
        const sa = await get("/api/alarms/active?q=TAGS_S_BH");
        expect(sa.body.offices).toEqual([{ office: OFFICE, count: 2 }]);
        expect((await get(`/api/alarms/active?q=TAGS_S_BH&office=ZZ/Other`)).body.total).toBe(0);
        expect(
          (await get(`/api/alarms/active?q=TAGS_S_BH&office=${encodeURIComponent(OFFICE)}`)).body
            .total,
        ).toBe(2);
      } finally {
        await prisma.alarm.deleteMany({ where: { site: { in: Object.values(sites) } } });
        await prisma.siteMaster.deleteMany({ where: { code: { in: ["9Z97ZT", "9Z96ZT"] } } });
      }
    });

    it("400 on invalid query", async () => {
      as("VIEWER");
      const r = await get("/api/alarms/active?category=FIRE&page=0");
      expect(r.status).toBe(400);
      expect(Object.keys(r.body.details)).toEqual(expect.arrayContaining(["category", "page"]));
    });
  });

  describe("hidden alarm types (display settings)", () => {
    afterAll(async () => {
      await prisma.systemStatus.updateMany({
        data: { displayFilter: { hiddenCategories: [], hiddenAlarmNames: [] } },
      });
    });

    it("hidden category and hidden names disappear from the active list", async () => {
      as("VIEWER");
      await prisma.systemStatus.upsert({
        where: { id: 1 },
        update: { displayFilter: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] } },
        create: { id: 1, displayFilter: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] } },
      });
      const r1 = await get(`/api/alarms/active?site=${PREFIX}`);
      expect(r1.body.items.map((a: { category: string }) => a.category)).toEqual(["DOWN"]);
      // Filtering by a hidden category cannot bring it back.
      const r2 = await get(`/api/alarms/active?site=${PREFIX}&category=POWER`);
      expect(r2.body.total).toBe(0);

      await prisma.systemStatus.update({
        where: { id: 1 },
        data: {
          displayFilter: { hiddenCategories: [], hiddenAlarmNames: ["S_D_N_BTS O&M LINK FAILURE"] },
        },
      });
      const r3 = await get(`/api/alarms/active?site=${PREFIX}`);
      expect(r3.body.items.map((a: { site: string }) => a.site)).toEqual([`${PREFIX}-B`]);
    });

    it("hidden types still show at the exception sites (admin and personal filters each)", async () => {
      as("VIEWER");
      const sites = (body: { items: { site: string }[] }) => body.items.map((a) => a.site).sort();
      const path = `/api/alarms/active?site=${PREFIX}`;
      // admin hides DOWN except at site A (full site name)
      await prisma.systemStatus.update({
        where: { id: 1 },
        data: {
          displayFilter: { hiddenCategories: ["DOWN"], hiddenAlarmNames: [], exceptSites: [`${PREFIX}-A`] },
        },
      });
      expect(sites((await get(path)).body)).toEqual([`${PREFIX}-A`, `${PREFIX}-B`]);
      // the daily chart (raw SQL) applies the same rule: no error, A still counted
      expect((await get("/api/stats/daily?days=2")).status).toBe(200);

      // the user hides POWER for themselves, with no exception → B goes; the admin's
      // exception for A does not lift the user's own filter (and the other way round)
      await prisma.user.update({
        where: { id: Number(users.VIEWER) },
        data: { displayPrefs: { hiddenCategories: ["POWER"], hiddenAlarmNames: [], exceptSites: [] } },
      });
      try {
        expect(sites((await get(path)).body)).toEqual([`${PREFIX}-A`]);
        // PUT /api/me/display stores the exceptions (upper-cased)
        const put = await api.call("/api/me/display", {
          method: "PUT",
          json: { hiddenCategories: ["POWER"], hiddenAlarmNames: [], exceptSites: [`${PREFIX.toLowerCase()}-b`] },
        });
        expect(put.status).toBe(200);
        expect(put.body.exceptSites).toEqual([`${PREFIX}-B`]);
        expect(sites((await get(path)).body)).toEqual([`${PREFIX}-A`, `${PREFIX}-B`]);
      } finally {
        await prisma.user.update({
          where: { id: Number(users.VIEWER) },
          data: { displayPrefs: { hiddenCategories: [], hiddenAlarmNames: [] } },
        });
        await prisma.systemStatus.update({
          where: { id: 1 },
          data: { displayFilter: { hiddenCategories: [], hiddenAlarmNames: [] } },
        });
      }
    });

    it("summary counts exclude hidden types", async () => {
      as("VIEWER");
      await prisma.systemStatus.update({
        where: { id: 1 },
        data: {
          displayFilter: { hiddenCategories: ["DOWN", "POWER", "OTHER"], hiddenAlarmNames: [] },
        },
      });
      const { body } = await get("/api/stats/summary");
      expect(body.active.total).toBe(0);
      await prisma.systemStatus.update({
        where: { id: 1 },
        data: { displayFilter: { hiddenCategories: [], hiddenAlarmNames: [] } },
      });
    });
  });

  describe("personal hidden types (My preferences)", () => {
    it("hide only for the user who chose them", async () => {
      const me = await prisma.user.create({
        data: {
          email: "zz-apitest-hider@local",
          passwordHash: "x",
          office: OFFICE,
          displayPrefs: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] },
        },
      });
      try {
        session.current = { user: { id: String(me.id) } };
        const mine = await get(`/api/alarms/active?site=${PREFIX}`);
        expect(mine.body.items.map((a: { category: string }) => a.category)).toEqual(["DOWN"]);

        as("VIEWER"); // someone else
        const theirs = await get(`/api/alarms/active?site=${PREFIX}`);
        expect(theirs.body.total).toBe(2);
      } finally {
        await prisma.user.delete({ where: { id: me.id } });
      }
    });
  });

  describe("GET /api/stats/summary", () => {
    it("401 without a session", async () => {
      session.current = null;
      expect((await get("/api/stats/summary")).status).toBe(401);
    });

    it("returns active counts, MTTR, overdue and last run", async () => {
      as("VIEWER");
      const { status, body } = await get("/api/stats/summary");
      expect(status).toBe(200);
      expect(body.active.DOWN).toBeGreaterThanOrEqual(1);
      expect(body.active.POWER).toBeGreaterThanOrEqual(1);
      expect(body.active.total).toBe(body.active.DOWN + body.active.POWER + body.active.OTHER);
      expect(body.overdue.alertHours).toBe(4);
      expect(body.overdue.count).toBeGreaterThanOrEqual(1); // the 10h-old test alarm
      expect(body.mttr.days).toBe(30);
      expect(body.mttr.byCategory.DOWN.count).toBeGreaterThanOrEqual(1);
      expect(typeof body.mttr.byCategory.DOWN.avgMin).toBe("number");
      expect(body.lastRun).toHaveProperty("ageSec");
      expect(body.lastRun).toHaveProperty("error");
    });
  });
  describe("office scope", () => {
    it("office users see only their office; the super admin sees all or the picked office", async () => {
      const path = `/api/alarms/active?site=${PREFIX}`;
      as("VIEWER");
      expect((await get(path)).body.total).toBe(2);
      const other = await prisma.user.create({
        data: { email: "zz-apitest-other@local", passwordHash: "x", office: "ZZ/Elsewhere" },
      });
      const none = await prisma.user.create({
        data: { email: "zz-apitest-none@local", passwordHash: "x" },
      });
      try {
        session.current = { user: { id: String(other.id) } };
        expect((await get(path)).body.total).toBe(0);
        session.current = { user: { id: String(none.id) } };
        expect((await get(path)).body.total).toBe(0); // no office = nothing
        as("SUPER_ADMIN"); // office null = all offices
        expect((await get(path)).body.total).toBe(2);
        await prisma.user.update({
          where: { id: Number(users.SUPER_ADMIN) },
          data: { office: "ZZ/Elsewhere" },
        });
        expect((await get(path)).body.total).toBe(0);
      } finally {
        await prisma.user.update({
          where: { id: Number(users.SUPER_ADMIN) },
          data: { office: null },
        });
        await prisma.user.deleteMany({ where: { id: { in: [other.id, none.id] } } });
      }
    });

    it("the super admin can view a whole office group (every ZZ/… office)", async () => {
      const path = `/api/alarms/active?site=${PREFIX}`;
      as("SUPER_ADMIN");
      const setView = (office: string | null) =>
        prisma.user.update({ where: { id: Number(users.SUPER_ADMIN) }, data: { office } });
      try {
        await setView("ZZ");
        const zz = await get(path);
        expect(zz.body.total).toBe(2);
        // the office filter is offered inside the group, and limited to it
        expect(zz.body.offices).toEqual([{ office: OFFICE, count: 2 }]);
        expect((await get(`${path}&office=${encodeURIComponent(OFFICE)}`)).body.total).toBe(2);
        expect((await get(`${path}&office=ZZ%2FOther`)).body.total).toBe(0);
        expect((await get(`${path}&office=YY%2FOther`)).body.total).toBe(2); // outside the group: ignored
        // stats (Prisma and raw SQL) follow the same scope
        expect((await get("/api/stats/summary")).status).toBe(200);
        const daily = await get("/api/stats/daily?days=2");
        expect(daily.status).toBe(200);
        await setView("ZY");
        expect((await get(path)).body.total).toBe(0);
      } finally {
        await setView(null);
      }
    });
  });

  describe("/api/users (office admin vs super admin)", () => {
    const send = (method: string, body?: unknown, query = "") =>
      api.call(`/api/users${query}`, { method, json: body });
    const NEW = `${PREFIX.toLowerCase()}-created@test.local`;
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: [NEW, "zz-apitest-foreign@local"] } } });
    });

    it("viewers and operators cannot manage users", async () => {
      as("OPERATOR");
      expect((await send("GET")).status).toBe(403);
    });

    it("office admin lists, creates and deletes viewers of their own office only", async () => {
      const foreign = await prisma.user.create({
        data: { email: "zz-apitest-foreign@local", passwordHash: "x", office: "ZZ/Elsewhere" },
      });
      as("ADMIN");
      const list = await send("GET");
      expect(list.status).toBe(200);
      const emails = list.body.users.map((u: { email: string }) => u.email);
      expect(emails).toContain(`${PREFIX.toLowerCase()}-viewer@test.local`);
      expect(emails).not.toContain("zz-apitest-foreign@local");
      expect(emails).not.toContain(`${PREFIX.toLowerCase()}-super_admin@test.local`);

      // Office in the body is ignored/forbidden: always their own office.
      expect(
        (await send("POST", { email: NEW, password: "password1", office: "ZZ/Elsewhere" })).status,
      ).toBe(403);
      const created = await send("POST", { email: NEW, password: "password1" });
      expect(created.status).toBe(201);
      expect(created.body.user).toMatchObject({ role: "VIEWER", office: OFFICE });
      expect(
        (await send("POST", { email: "x-" + NEW, password: "password1", role: "ADMIN" })).status,
      ).toBe(403);
      expect((await send("PATCH", { id: created.body.user.id, role: "SUPER_ADMIN" })).status).toBe(
        403,
      );

      expect((await send("DELETE", undefined, `?id=${foreign.id}`)).status).toBe(404);
      expect((await send("DELETE", undefined, `?id=${users.ADMIN}`)).status).toBe(400);
      expect((await send("DELETE", undefined, `?id=${created.body.user.id}`)).status).toBe(200);
    });

    it("super admin creates an office admin for any office", async () => {
      as("SUPER_ADMIN");
      const r = await send("POST", {
        email: NEW,
        password: "password1",
        role: "ADMIN",
        office: OFFICE,
      });
      expect(r.status).toBe(201);
      expect(r.body.user).toMatchObject({ role: "ADMIN", office: OFFICE });
      expect(
        (await send("POST", { email: "y-" + NEW, password: "password1", role: "VIEWER" })).status,
      ).toBe(403);
    });
  });
});

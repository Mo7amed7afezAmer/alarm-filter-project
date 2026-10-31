// HTTP tests for the HOTLINE role against alarms_test: the super admin's powers (every office,
// office view, Site Master of every office) without the settings for everyone (classification,
// hidden-for-everyone types, users, Gmail, value normalization, hourly settings).
// Touches only its own test users.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./harness.js";

const url = process.env.TEST_DATABASE_URL;
const api = createHarness();
const PREFIX = "ZZ-HOTLINETEST";
let users: import("./test-users.js").TestUsers;
const as = (role: keyof typeof users) => (api.session.current = { user: { id: users[role] } });
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!url)("hotline role", () => {
  let prisma: typeof import("@alarm/db").prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    await api.start();
    users = await (await import("./test-users.js")).createTestUsers(prisma, PREFIX, null);
  });

  afterAll(async () => {
    if (!prisma) return;
    await (await import("./test-users.js")).removeTestUsers(prisma, PREFIX);
    await api.stop();
  });

  it("may pick the office it views, like the super admin; office users may not", async () => {
    as("HOTLINE");
    expect((await api.call("/api/settings/office", json("PUT", { office: null }))).status).toBe(
      200,
    );
    as("ADMIN");
    expect((await api.call("/api/settings/office", json("PUT", { office: null }))).status).toBe(
      403,
    );
  });

  it("manages the sites of every office", async () => {
    as("HOTLINE");
    const r = await api.call("/api/site-master?pageSize=1");
    expect(r.status).toBe(200);
    expect(r.body.meta.canManage).toBe(true);
  });

  it("has no say in the settings for everyone", async () => {
    as("HOTLINE");
    expect((await api.call("/api/rules")).status).toBe(403);
    expect((await api.call("/api/rules", json("PUT", { rules: [] }))).status).toBe(403);
    expect(
      (
        await api.call(
          "/api/settings/display",
          json("PUT", { hiddenCategories: [], hiddenAlarmNames: [] }),
        )
      ).status,
    ).toBe(403);
    expect((await api.call("/api/users")).status).toBe(403);
    expect((await api.call("/api/users")).body.error).toBe("Not available to hotline accounts");
    expect((await api.call("/api/gmail/account")).status).toBe(403);
    expect((await api.call("/api/hourly-normalizations", json("PUT", { rules: [] }))).status).toBe(
      403,
    );
    expect((await api.call("/api/hourly-settings", json("PUT", {}))).status).toBe(403);
    // reads what everyone reads
    expect((await api.call("/api/hourly-settings")).body.meta.editKey).toBeNull();
  });

  it("only the super admin creates hotline accounts (no office needed)", async () => {
    const email = `${PREFIX.toLowerCase()}-made@test.local`;
    const body = json("POST", { email, password: "Hotline-test-123", role: "HOTLINE" });
    as("ADMIN");
    expect((await api.call("/api/users", body)).status).toBe(403);
    as("SUPER_ADMIN");
    expect((await api.call("/api/users", body)).status).toBe(201);
    const made = await prisma.user.findUnique({ where: { email } });
    expect(made).toMatchObject({ role: "HOTLINE", office: null });
  });
});

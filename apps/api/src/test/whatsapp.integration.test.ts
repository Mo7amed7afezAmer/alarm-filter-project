// HTTP tests for /api/whatsapp against alarms_test, with a fake sender service on a random port
// (the real one needs a linked phone). Checks roles, the saved-chats rule, what is forwarded and
// the send log. Touches only its own test users and their whatsapp_sends rows.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./harness.js";

const url = process.env.TEST_DATABASE_URL;
const api = createHarness();
const PREFIX = "ZZ-WHATSAPPTEST";
const GROUP = "https://chat.whatsapp.com/AbCdEfGhIj1234567890";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString("base64");
let users: import("./test-users.js").TestUsers;
const as = (role: keyof typeof users) => (api.session.current = { user: { id: users[role] } });
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!url)("whatsapp API", () => {
  let prisma: typeof import("@alarm/db").prisma;
  let fake: Server;
  const got: { path: string; token: string | undefined; body: unknown }[] = [];
  let failNext = false;

  beforeAll(async () => {
    fake = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      got.push({
        path: req.url ?? "",
        token: req.headers["x-internal-token"] as string | undefined,
        body: text ? JSON.parse(text) : null,
      });
      res.writeHead(failNext ? 502 : 200, { "Content-Type": "application/json" });
      if (failNext) {
        failNext = false;
        res.end(JSON.stringify({ error: "The group link is not valid (reset or expired)" }));
      } else if (req.url?.startsWith("/status"))
        res.end(
          JSON.stringify({
            state: "connected",
            qr: "data:qr",
            me: { phone: "201000000000", name: "Alarm" },
            error: null,
          }),
        );
      else res.end(JSON.stringify({ chat: "Kafr ElDawar group", sent: 2 }));
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    process.env.WHATSAPP_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    process.env.WHATSAPP_TOKEN = "test-token";
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    await api.start();
    users = await (
      await import("./test-users.js")
    ).createTestUsers(prisma, PREFIX, "DN/Kafr ElDawar");
    // the operator saved the group as their "all images" chat
    await prisma.user.update({
      where: { id: Number(users.OPERATOR) },
      data: { uiPrefs: { alarms: { image: { shareAll: GROUP } } } },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.whatsappSend.deleteMany({
      where: { userEmail: { startsWith: `${PREFIX.toLowerCase()}-` } },
    });
    await (await import("./test-users.js")).removeTestUsers(prisma, PREFIX);
    await api.stop();
    fake?.close();
  });

  it("status: each account asks for its own session; viewers have none", async () => {
    as("VIEWER");
    const before = got.length;
    const v = await api.call("/api/whatsapp/status");
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ state: "disconnected", qr: null, canSend: false });
    expect(got.length).toBe(before); // the sender is not even asked
    as("OPERATOR");
    expect((await api.call("/api/whatsapp/status?start=1")).body.data).toMatchObject({
      state: "connected",
      qr: "data:qr",
      canSend: true,
    });
    expect(got.at(-1)?.path).toBe(`/status?user=${users.OPERATOR}&start=1`);
    expect(got.at(-1)?.token).toBe("test-token");
    // the super admin takes over the number linked before per-user sending
    as("SUPER_ADMIN");
    await api.call("/api/whatsapp/status");
    expect(got.at(-1)?.path).toBe(`/status?user=${users.SUPER_ADMIN}&adopt=1`);
  });

  it("send: viewers 403, unsaved chats 403, saved chat forwarded and logged", async () => {
    as("VIEWER");
    expect((await api.call("/api/whatsapp/send", post({ chat: GROUP, text: "x" }))).status).toBe(
      403,
    );
    as("OPERATOR");
    const other = await api.call("/api/whatsapp/send", post({ chat: "01012345678", text: "x" }));
    expect(other.status).toBe(403);
    // the link as typed (invite/ form) is the same saved chat
    const ok = await api.call(
      "/api/whatsapp/send",
      post({
        chat: "chat.whatsapp.com/invite/AbCdEfGhIj1234567890",
        text: "update",
        images: [{ name: "a.png", data: PNG }],
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ chat: "Kafr ElDawar group", sent: 2 });
    expect(got.at(-1)).toMatchObject({
      path: `/send?user=${users.OPERATOR}`,
      body: { chat: GROUP, text: "update", images: [{ name: "a.png", data: PNG }] },
    });
    const log = await prisma.whatsappSend.findFirst({
      where: { userId: Number(users.OPERATOR) },
      orderBy: { id: "desc" },
    });
    expect(log).toMatchObject({
      chat: GROUP,
      chatName: "Kafr ElDawar group",
      texts: 1,
      images: 1,
      ok: true,
    });
  });

  it("send: a sender error comes back as 502 and is logged as failed", async () => {
    as("OPERATOR");
    failNext = true;
    const r = await api.call("/api/whatsapp/send", post({ chat: GROUP, text: "x" }));
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("group link is not valid");
    const log = await prisma.whatsappSend.findFirst({
      where: { userId: Number(users.OPERATOR) },
      orderBy: { id: "desc" },
    });
    expect(log).toMatchObject({ ok: false });
  });

  it("log-out of one's own number; the send log shows one's own sends (super admin: all)", async () => {
    as("VIEWER");
    expect((await api.call("/api/whatsapp/logout", { method: "POST" })).status).toBe(403);
    expect((await api.call("/api/whatsapp/sends")).status).toBe(403);
    as("ADMIN");
    expect((await api.call("/api/whatsapp/logout", { method: "POST" })).status).toBe(200);
    expect(got.at(-1)?.path).toBe(`/logout?user=${users.ADMIN}`);
    expect((await api.call("/api/whatsapp/sends")).body.data).toEqual([]);
    as("OPERATOR");
    const mine = (await api.call("/api/whatsapp/sends")).body.data as { userId: number }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.userId === Number(users.OPERATOR))).toBe(true);
    as("SUPER_ADMIN");
    expect((await api.call("/api/whatsapp/sends")).body.data.length).toBeGreaterThan(0);
  });
});

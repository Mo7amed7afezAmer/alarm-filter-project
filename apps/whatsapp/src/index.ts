// WhatsApp sender service (internal, never published): the API calls it to post the alarm
// images / updates from the signed-in user's own linked number. Every request needs the shared
// token (X-Internal-Token = WHATSAPP_TOKEN, else NEXTAUTH_SECRET) and names the account
// (`user` = users.id; the API checks who may use it).
//   GET  /health                              200 while the process runs
//   GET  /status?user=&start=1&adopt=1        {state, qr, me, error}; start = show a QR when not
//                                             linked; adopt = take over the old single session
//   POST /logout?user=
//   POST /send?user=  {chat, text?, images?: [{name, data(base64 PNG)}]} → {chat, sent}

import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { planSend } from "./plan.js";
import { SenderPool } from "./pool.js";

const PORT = Number(process.env.WHATSAPP_PORT ?? 4300);
const SESSION_DIR = resolve(process.env.WHATSAPP_SESSION_DIR ?? "../../data/whatsapp");
const TOKEN = process.env.WHATSAPP_TOKEN || process.env.NEXTAUTH_SECRET;
/** 30 images of ≤ 5 MB in base64 plus some room. */
const MAX_BODY = 210 * 1024 * 1024;

if (!TOKEN) {
  console.error("WHATSAPP_TOKEN (or NEXTAUTH_SECRET) is required");
  process.exit(1);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("body must be JSON"), { status: 400 });
  }
}

const pool = new SenderPool(SESSION_DIR);

createServer(async (req, res) => {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/health") return reply(200, { ok: true });
    if (req.headers["x-internal-token"] !== TOKEN) return reply(401, { error: "unauthorized" });
    const key = url.searchParams.get("user") ?? "";
    const sender = pool.get(key);
    if (req.method === "GET" && path === "/status") {
      if (url.searchParams.get("adopt") === "1") await pool.adoptLegacy(key);
      // a linked number always runs; a QR only when the settings page asks for one
      if (sender.linked || url.searchParams.get("start") === "1") sender.ensureStarted();
      return reply(200, sender.getStatus());
    }
    if (req.method === "POST" && path === "/logout") {
      await sender.logout();
      return reply(200, { ok: true });
    }
    if (req.method === "POST" && path === "/send") {
      const plan = planSend(await readJson(req));
      if (!plan.ok) return reply(400, { error: plan.error });
      return reply(200, await sender.send(plan.chat, plan.messages));
    }
    return reply(404, { error: "not found" });
  } catch (e) {
    const err = e as Error & { status?: number };
    reply(err.status ?? 502, { error: err.message });
  }
}).listen(PORT, "0.0.0.0", () =>
  console.log(`whatsapp sender on :${PORT}, sessions in ${SESSION_DIR}/users`),
);

void pool.boot().catch((e) => console.error("WhatsApp boot failed:", e));

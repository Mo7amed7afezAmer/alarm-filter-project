// One WhatsApp connection (Baileys, linked like WhatsApp Web through a QR code). Keeps its
// login in its session folder and reconnects on drops while linked. A QR that nobody scanned,
// or a log-out (here or from the phone), stops it: the next status request with `start` shows a
// new QR — so accounts that never link do not keep a connection open.

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { PAUSE_MS, type ChatRef, type Outgoing } from "./plan.js";

export type LinkState = "starting" | "qr" | "connected" | "disconnected";

export interface SenderStatus {
  state: LinkState;
  /** QR code to scan (data: URL), while state = "qr". */
  qr: string | null;
  /** The linked number and its WhatsApp name. */
  me: { phone: string; name: string | null } | null;
  /** Last connection problem, cleared on connect. */
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logger = pino({ level: process.env.WHATSAPP_LOG ?? "warn" });

export class WhatsAppSender {
  private sock: WASocket | null = null;
  private starting = false;
  private status: SenderStatus = { state: "disconnected", qr: null, me: null, error: null };
  /** Group invite code → group id (an invite link is resolved once). */
  private groups = new Map<string, { jid: string; name: string }>();
  /** One send at a time, so pauses between messages hold across requests. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly sessionDir: string) {}

  getStatus(): SenderStatus {
    return { ...this.status };
  }

  /** A number was linked here (its login is saved). */
  get linked(): boolean {
    return existsSync(join(this.sessionDir, "creds.json"));
  }

  /** Starts the connection unless it is up or starting. */
  ensureStarted(): void {
    if (this.sock || this.starting) return;
    this.starting = true;
    this.status = { ...this.status, state: "starting" };
    void this.start()
      .catch((e) => {
        this.status = { ...this.status, state: "disconnected", error: (e as Error).message };
      })
      .finally(() => {
        this.starting = false;
      });
  }

  private async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      // offline: Baileys' built-in version
    }
    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger,
      browser: ["Alarm Filter", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.qr) {
        void QRCode.toDataURL(u.qr, { margin: 1, width: 280 }).then((qr) => {
          this.status = { ...this.status, state: "qr", qr, error: null };
        });
      }
      if (u.connection === "open") {
        const id = sock.user?.id ?? "";
        this.status = {
          state: "connected",
          qr: null,
          me: { phone: id.split(":")[0]!.split("@")[0]!, name: sock.user?.name ?? null },
          error: null,
        };
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const wasLinked = !!state.creds.me && !loggedOut;
        this.status = {
          state: "disconnected",
          qr: null,
          me: null,
          error: loggedOut ? "Logged out" : (u.lastDisconnect?.error?.message ?? null),
        };
        this.sock = null;
        if (loggedOut) void rm(this.sessionDir, { recursive: true, force: true });
        // a linked number reconnects by itself; an unscanned QR waits for the next request
        else if (wasLinked) void sleep(3000).then(() => this.ensureStarted());
      }
    });
  }

  async logout(): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp is not linked");
    await this.sock.logout();
  }

  /** The chat id of a number / group; throws when the number has no WhatsApp or the link is bad. */
  async resolve(ref: ChatRef): Promise<{ jid: string; name: string }> {
    const sock = this.connected();
    if (ref.kind === "phone") {
      const [hit] = (await sock.onWhatsApp(ref.phone)) ?? [];
      if (!hit?.exists) throw new Error(`+${ref.phone} has no WhatsApp`);
      return { jid: hit.jid, name: `+${ref.phone}` };
    }
    const known = this.groups.get(ref.code);
    if (known) return known;
    const info = await sock.groupGetInviteInfo(ref.code).catch(() => {
      throw new Error("The group link is not valid (reset or expired)");
    });
    const group = { jid: info.id, name: info.subject };
    this.groups.set(ref.code, group);
    return group;
  }

  /** Sends the messages in order, PAUSE_MS apart; queued behind any send in progress. */
  send(ref: ChatRef, messages: Outgoing[]): Promise<{ chat: string; sent: number }> {
    const run = async () => {
      const { jid, name } = await this.resolve(ref);
      let sent = 0;
      for (const m of messages) {
        if (sent) await sleep(PAUSE_MS);
        const sock = this.connected();
        if (m.kind === "text") await sock.sendMessage(jid, { text: m.text });
        else await sock.sendMessage(jid, { image: m.png, mimetype: "image/png" });
        sent++;
      }
      return { chat: name, sent };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private connected(): WASocket {
    if (!this.sock || this.status.state !== "connected")
      throw new Error(
        "Your WhatsApp is not linked — scan the QR code in Settings → WhatsApp sender",
      );
    return this.sock;
  }
}

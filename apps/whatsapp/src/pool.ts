// One WhatsApp connection per account (user request 2026-10-29: every role except viewer links
// its own number). Sessions live in <root>/users/<userId>. The single session of the first
// version (files directly in <root>) is moved to the first super admin who asks for it.

import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { WhatsAppSender } from "./sender.js";

/** User ids are numbers (users.id); anything else is refused before touching the disk. */
export const USER_KEY = /^\d{1,12}$/;

export class SenderPool {
  private senders = new Map<string, WhatsAppSender>();

  constructor(private readonly root: string) {}

  private dirOf(key: string) {
    return join(this.root, "users", key);
  }

  /** Starts every account that has a linked number (on service start). */
  async boot(): Promise<void> {
    const users = join(this.root, "users");
    if (!existsSync(users)) return;
    for (const key of await readdir(users)) {
      if (!USER_KEY.test(key)) continue;
      const s = this.get(key);
      if (s.linked) s.ensureStarted();
    }
  }

  get(key: string): WhatsAppSender {
    if (!USER_KEY.test(key)) throw Object.assign(new Error("bad user"), { status: 400 });
    let s = this.senders.get(key);
    if (!s) {
      s = new WhatsAppSender(this.dirOf(key));
      this.senders.set(key, s);
    }
    return s;
  }

  /** Moves the old single session (files in the root) to this account, once. */
  async adoptLegacy(key: string): Promise<boolean> {
    if (!existsSync(join(this.root, "creds.json"))) return false;
    const dir = this.dirOf(key);
    if (existsSync(join(dir, "creds.json"))) return false;
    await mkdir(dir, { recursive: true });
    for (const f of await readdir(this.root, { withFileTypes: true }))
      if (f.isFile()) await rename(join(this.root, f.name), join(dir, f.name));
    return true;
  }
}

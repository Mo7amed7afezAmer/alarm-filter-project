import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SenderPool } from "./pool.js";

describe("SenderPool", () => {
  let root = "";
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("one session folder per user id; anything else is refused", async () => {
    root = await mkdtemp(join(tmpdir(), "wa-"));
    const pool = new SenderPool(root);
    expect(pool.get("12").sessionDir).toBe(join(root, "users", "12"));
    expect(pool.get("12")).toBe(pool.get("12"));
    expect(() => pool.get("../x")).toThrow("bad user");
    expect(() => pool.get("")).toThrow("bad user");
  });

  it("moves the old single session to the first account that adopts it, once", async () => {
    root = await mkdtemp(join(tmpdir(), "wa-"));
    await writeFile(join(root, "creds.json"), "{}");
    await writeFile(join(root, "app-state-sync-key-A.json"), "{}");
    const pool = new SenderPool(root);
    expect(await pool.adoptLegacy("7")).toBe(true);
    expect((await readdir(join(root, "users", "7"))).sort()).toEqual([
      "app-state-sync-key-A.json",
      "creds.json",
    ]);
    expect(existsSync(join(root, "creds.json"))).toBe(false);
    expect(pool.get("7").linked).toBe(true);
    // nothing left to adopt for anyone else
    expect(await pool.adoptLegacy("8")).toBe(false);
    expect(pool.get("8").linked).toBe(false);
  });
});

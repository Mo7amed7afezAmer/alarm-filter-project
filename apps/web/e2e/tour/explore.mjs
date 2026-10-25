// Warm-up + exploration: visits every page once (compiles `next dev` routes) and dumps
// headings / buttons so the tour script can target them.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const BASE = process.env.BASE ?? "http://localhost:3310";
const pages = (process.argv[2] ?? "/alarms,/cleared,/dashboard,/hourly,/hourly/compare,/settings/general,/settings/notifications,/settings/alarms/display,/settings/alarms/classification,/settings/hourly,/settings/users,/settings/office,/settings/reprocess,/settings/gmail,/settings/site-master").split(",");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(BASE + "/login", { timeout: 300000 });
await p.fill('input[name=email]', env.DEV_TEST_EMAIL);
await p.fill('input[name=password]', env.DEV_TEST_PASSWORD);
await p.click('button[type=submit]');
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300000 });
for (const path of pages) {
  const t = Date.now();
  await p.goto(BASE + path, { timeout: 300000 });
  await p.waitForLoadState("networkidle", { timeout: 300000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => ({
    h: [...document.querySelectorAll("h1,h2,h3")].map((e) => e.textContent.trim()).slice(0, 25),
    btn: [...document.querySelectorAll("button,a[href],select,[role=tab]")].map((e) => (e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 40) + (e.tagName === "A" ? "→" + e.getAttribute("href") : "")).filter(Boolean).slice(0, 80),
    rows: document.querySelectorAll("tbody tr").length,
  }));
  console.log(`\n=== ${path} (${Date.now() - t} ms) rows=${info.rows}\nH: ${info.h.join(" | ")}\nB: ${info.btn.join(" | ")}`);
}
await b.close();

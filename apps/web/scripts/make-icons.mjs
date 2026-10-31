// App icons for the installable web app (PWA): the sidebar logo — Lucide's radio tower in white
// on the brand teal tile — drawn by a headless Chromium into public/icons/*.png.
//   node scripts/make-icons.mjs   (from apps/web; re-run after changing the design)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(out, { recursive: true });

const NAVY = "#0f1b2d";
const TEAL = "#0d9488";
const tower = `<g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/>
  <circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/>
  <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/></g>`;

/** `any`: the teal tile with round corners on transparency. */
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="4" y="4" width="92" height="92" rx="22" fill="${TEAL}"/>
  <g transform="translate(22 21) scale(2.35)">${tower}</g></svg>`;
/** `maskable` / Apple: full navy square, the tile inside the 80 % safe zone. */
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${NAVY}"/>
  <rect x="18" y="18" width="64" height="64" rx="16" fill="${TEAL}"/>
  <g transform="translate(31 30) scale(1.6)">${tower}</g></svg>`;

writeFileSync(path.join(out, "icon.svg"), any);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, svg, size] of [
  ["icon-192.png", any, 192],
  ["icon-512.png", any, 512],
  ["maskable-512.png", full, 512],
  ["apple-touch-icon.png", full, 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(out, name), omitBackground: true });
  console.log("wrote", name);
}
await browser.close();

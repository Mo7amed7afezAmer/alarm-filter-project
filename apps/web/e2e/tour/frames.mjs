// Saves stills of the finished tour video for a quick visual check (the bundled ffmpeg cannot
// decode VP8, so a headless Chromium <video> is seeked instead).
//   node e2e/tour/frames.mjs <outDir> 10 60 120 ...   (seconds)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, `../../../../docs/video/${process.env.NAME ?? "alarm-filter-tour"}.webm`);
const [outDir, ...times] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("http://tour.local/**", (r) =>
  r.request().url().endsWith(".webm")
    ? r.fulfill({ path: video, contentType: "video/webm" })
    : r.fulfill({ body: '<body style="margin:0"><video id="v" muted style="width:1440px;height:900px"></video>', contentType: "text/html" }),
);
await page.goto("http://tour.local/");
const duration = await page.evaluate(async () => {
  const v = document.getElementById("v");
  v.src = URL.createObjectURL(await (await fetch("/tour.webm")).blob());
  await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  return v.duration;
});
console.log("duration", duration);
for (const t of times) {
  await page.evaluate(async (t) => {
    const v = document.getElementById("v");
    v.currentTime = t;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  }, Number(t));
  await page.screenshot({ path: path.join(outDir, `t${String(t).padStart(4, "0")}.png`) });
}
await browser.close();

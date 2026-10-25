// Cuts the dead `next dev` loading time (docs/video/cuts.json, written by tour.mjs) out of the
// raw recording. Playwright's bundled ffmpeg cannot decode VP8, so the cut happens in headless
// Chromium: the raw video plays in a <video>, MediaRecorder records its stream and is paused
// while the player jumps over each cut. ffmpeg then only remuxes (-c copy) to add the duration
// and seek index that MediaRecorder files lack.
//   node e2e/tour/cut.mjs   → docs/video/alarm-filter-tour.webm (raw kept as *-raw.webm)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../../../docs/video");
const pwDir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".cache"), "ms-playwright");
const ffDir = readdirSync(pwDir).filter((d) => d.startsWith("ffmpeg-")).sort().pop();
const ffmpeg = path.join(pwDir, ffDir, process.platform === "win32" ? "ffmpeg-win64.exe" : "ffmpeg-linux");

const final = path.join(dir, "alarm-filter-tour.webm");
const raw = path.join(dir, "alarm-filter-tour-raw.webm");
const tmp = path.join(dir, ".cut.webm");
if (!existsSync(raw)) renameSync(final, raw);
const cuts = JSON.parse(readFileSync(path.join(dir, "cuts.json"), "utf8"))
  .filter(([a, b]) => b - a > 0.5)
  .sort((x, y) => x[0] - y[0]);
console.log(`${cuts.length} cuts, ${cuts.reduce((s, [a, b]) => s + b - a, 0).toFixed(0)} s removed`);

const player = path.join(dir, ".player.html");
writeFileSync(player, `<!doctype html><body style="margin:0;background:#000">
<video id="v" muted playsinline style="width:1440px;height:900px"></video></body>`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(0);
// a fake http origin (file:// media is "cross-origin" for captureStream)
await page.route("http://tour.local/**", (route) => {
  const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
  route.fulfill({ path: path.join(dir, name), contentType: name.endsWith(".html") ? "text/html" : "video/webm" });
});
await page.goto("http://tour.local/.player.html");
const t0 = Date.now();
const progress = setInterval(async () => {
  const t = await page.evaluate(() => document.getElementById("v").currentTime).catch(() => 0);
  console.log(`  at ${t.toFixed(0)} s (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
}, 30_000);
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate(async (cuts) => {
    const v = document.getElementById("v");
    // a blob URL is same-origin and fully seekable (the fake route has no Range support)
    v.src = URL.createObjectURL(await (await fetch("alarm-filter-tour-raw.webm")).blob());
    await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener("loadedmetadata", r, { once: true })));
    const mime = "video/webm;codecs=vp8";
    const rec = new MediaRecorder(v.captureStream(), { mimeType: mime, videoBitsPerSecond: 700_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    let i = 0;
    const jump = async () => {
      // skip over every cut that starts before the current position
      while (i < cuts.length && v.currentTime >= cuts[i][0] - 0.05) {
        rec.pause();
        v.pause();
        v.currentTime = cuts[i][1];
        i++;
        await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
        await v.play();
        rec.resume();
      }
    };
    v.addEventListener("timeupdate", () => void jump());
    // MediaRecorder runs on wall-clock time: a playback stall would turn into frozen video
    v.addEventListener("waiting", () => rec.state === "recording" && rec.pause());
    v.addEventListener("playing", () => rec.state === "paused" && rec.resume());
    await v.play();
    rec.start(1000);
    await jump();
    await new Promise((r) => v.addEventListener("ended", r, { once: true }));
    rec.stop();
    await stopped;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    a.download = "tour.webm";
    a.click();
  }, cuts),
]);
clearInterval(progress);
await download.saveAs(tmp);
await browser.close();
rmSync(player);
execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-c", "copy", final], { stdio: "inherit" });
rmSync(tmp);
console.log("written", final);

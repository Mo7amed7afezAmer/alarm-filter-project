// Silent "screen recording" of the main functions per role (user request 2026-10-29): a headless
// Chromium driven by Playwright `recordVideo`, with a floating text bubble next to each
// highlighted element (what it does, in a few words), full-screen role cards and a fake cursor.
// No narration, no sound.
// Needs the mock dev servers from .claude/launch.json: api-tour-mock (:4110) + web-via-api-mock
// (:3310), and DEV_TEST_EMAIL / DEV_TEST_PASSWORD (an office admin) in apps/web/.env.local.
// Temporary tour accounts (operator, hotline, super admin) are created with random passwords
// in the dev DB and deleted at the end, with any WhatsApp session folder they got.
// Every account records in the Dark theme by default (TOUR_THEME=blue|dark|light overrides);
// the office admin's own prefs are put back at the end.
//   node e2e/tour/tour-roles.mjs   → docs/video/alarm-filter-roles.webm + alarm-filter-roles-cuts.json
//   NAME=alarm-filter-roles node e2e/tour/cut.mjs   → cuts the slow page loads out
import { chromium } from "@playwright/test";
import bcrypt from "bcryptjs";
import prismaClient from "@prisma/client"; // CommonJS → default import, then pick Prisma (JsonNull)
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(path.join(here, "../../.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
process.env.DATABASE_URL ??= env.DATABASE_URL;
const { prisma } = await import("@alarm/db");
const { Prisma } = prismaClient;

const BASE = process.env.BASE ?? "http://localhost:3310";
const OUT = path.resolve(here, "../../../../docs/video");
const RAW = path.join(OUT, ".raw-roles");
const NAME = "alarm-filter-roles";
const SESSIONS = path.resolve(here, "../../../../data/whatsapp/users");
const W = 1440;
const H = 900;
const SPEED = Number(process.env.TOUR_SPEED ?? 1); // < 1 = faster (dry runs)
const THEME = ["blue", "dark", "light"].includes(process.env.TOUR_THEME) ? process.env.TOUR_THEME : "dark"; // the theme the video is recorded in (TOUR_THEME=blue|dark|light)

/** Temporary accounts, one per role the test account is not. */
const TOUR = [
  { key: "operator", email: "tour-operator@tour.local", role: "OPERATOR", office: "DN/Kafr ElDawar" },
  { key: "hotline", email: "tour-hotline@tour.local", role: "HOTLINE", office: null },
  { key: "super", email: "tour-super@tour.local", role: "SUPER_ADMIN", office: null },
];

// ---------- overlay injected into every document ----------
const overlay = () => {
  const css = `
  #tour-scene{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483646;
    padding:7px 20px;border-radius:999px;background:#0d9488;color:#fff;
    font:700 18px/1.4 "Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;box-shadow:0 4px 14px rgba(0,0,0,.35)}
  #tour-scene:empty{display:none}
  #tour-tip{position:fixed;z-index:2147483646;width:max-content;max-width:430px;padding:14px 18px;border-radius:14px;
    background:#0b1324;color:#f8fafc;border:2px solid #2dd4bf;box-shadow:0 10px 30px rgba(0,0,0,.5);
    font:600 21px/1.55 "Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;text-align:right;transition:opacity .2s}
  #tour-tip:empty{display:none}
  #tour-tip b{color:#5eead4;font-weight:700;unicode-bidi:isolate;direction:ltr;display:inline-block}
  #tour-card{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;
    background:rgba(6,11,22,.92)}
  #tour-card.on{display:flex}
  #tour-card .p{width:980px;padding:56px 64px;border-radius:24px;background:#13233a;border-right:14px solid #14b8a6;
    direction:rtl;text-align:right;color:#f8fafc;font-family:"Segoe UI",Tahoma,Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  #tour-card .e{font-size:26px;font-weight:700;line-height:1.4;color:#5eead4;margin-bottom:12px}
  #tour-card .t{font-size:52px;font-weight:800;line-height:1.3;margin-bottom:30px}
  #tour-card .l{font-size:30px;font-weight:500;line-height:1.6;color:#cbd5e1;margin:10px 0;padding-right:30px;position:relative}
  #tour-card .l:before{content:"";position:absolute;right:0;top:20px;width:12px;height:12px;border-radius:3px;background:#14b8a6}
  #tour-card b{color:#5eead4;unicode-bidi:isolate;direction:ltr;display:inline-block}
  #tour-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(250,204,21,.55);border:2px solid #facc15;pointer-events:none;
    transition:left .6s ease,top .6s ease,transform .15s}
  #tour-cursor.down{transform:scale(.6)}
  .tour-spot{position:fixed;z-index:2147483645;border:3px solid #facc15;border-radius:10px;pointer-events:none;
    box-shadow:0 0 0 5px rgba(250,204,21,.25),0 0 18px rgba(250,204,21,.45)}
  .tour-blur{filter:blur(7px)!important}`;
  const mount = () => {
    if (document.getElementById("tour-tip")) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    for (const id of ["tour-scene", "tour-tip", "tour-card", "tour-cursor"]) {
      const d = document.createElement("div");
      d.id = id;
      document.body.appendChild(d);
    }
    const s = JSON.parse(sessionStorage.getItem("tour") || "{}");
    document.getElementById("tour-scene").textContent = s.scene || "";
    const c = document.getElementById("tour-cursor");
    c.style.left = (s.x ?? 720) + "px";
    c.style.top = (s.y ?? 450) + "px";
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));
const password = () => randomBytes(18).toString("base64url");

async function main() {
  // ---------- tour accounts ----------
  const made = {};
  for (const a of TOUR) {
    await prisma.user.deleteMany({ where: { email: a.email } });
    const pw = password();
    const u = await prisma.user.create({
      data: { email: a.email, passwordHash: await bcrypt.hash(pw, 10), role: a.role, office: a.office, uiPrefs: { theme: THEME } },
    });
    made[a.key] = { ...a, id: u.id, pw };
  }
  // the office-admin part signs in as DEV_TEST_EMAIL → same theme for it, its own prefs restored at the end
  const admin = await prisma.user.findUnique({ where: { email: env.DEV_TEST_EMAIL }, select: { id: true, uiPrefs: true } });
  if (admin) {
    const prefs = admin.uiPrefs && typeof admin.uiPrefs === "object" && !Array.isArray(admin.uiPrefs) ? admin.uiPrefs : {};
    await prisma.user.update({ where: { id: admin.id }, data: { uiPrefs: { ...prefs, theme: THEME } } });
  }

  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: RAW, size: { width: W, height: H } },
    acceptDownloads: true,
    locale: "en-US",
  });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const cuts = [];
  let mark = t0;
  page.setDefaultTimeout(60_000);
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  // ---------- helpers ----------
  const state = (patch) =>
    page
      .evaluate((p) => {
        const s = { ...JSON.parse(sessionStorage.getItem("tour") || "{}"), ...p };
        sessionStorage.setItem("tour", JSON.stringify(s));
        const sc = document.getElementById("tour-scene");
        if (sc && "scene" in p) sc.textContent = p.scene;
      }, patch)
      .catch(() => {});
  const scene = async (title) => {
    log("scene:", title);
    await state({ scene: title });
  };
  /** Everything between the last action and now longer than ~3 s is dead time → cut list. */
  const waited = () => {
    const now = Date.now();
    if (now - mark > 3000) cuts.push([(mark - t0 + 900) / 1000, (now - t0 - 200) / 1000]);
    mark = now;
  };
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 90_000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    waited();
    await sleep(700);
  };
  const go = async (p) => {
    mark = Date.now();
    await page.goto(BASE + p, { timeout: 300_000 });
    await settle();
  };
  const moveTo = async (loc) => {
    await loc.scrollIntoViewIfNeeded({ timeout: 15_000 }).catch(() => {});
    const b = await loc.boundingBox({ timeout: 20_000 }).catch(() => null);
    if (!b) return null;
    const x = Math.round(b.x + b.width / 2);
    const y = Math.round(b.y + b.height / 2);
    await page.evaluate(([x, y]) => {
      const c = document.getElementById("tour-cursor");
      if (c) Object.assign(c.style, { left: x + "px", top: y + "px" });
    }, [x, y]);
    await state({ x, y });
    await sleep(650);
    return b;
  };
  const press = async () => {
    await page.evaluate(() => document.getElementById("tour-cursor")?.classList.add("down")).catch(() => {});
    await sleep(160);
    await page.evaluate(() => document.getElementById("tour-cursor")?.classList.remove("down")).catch(() => {});
  };
  const click = async (loc, after = 1100, opts = {}) => {
    await moveTo(loc);
    await press();
    await loc.click({ timeout: 15_000, ...opts });
    mark = Date.now();
    await sleep(after);
  };
  const clearTip = () =>
    page
      .evaluate(() => {
        document.querySelectorAll(".tour-spot").forEach((e) => e.remove());
        const t = document.getElementById("tour-tip");
        if (t) t.innerHTML = "";
      })
      .catch(() => {});
  /** Outline an element and float a short text beside it (below, else above). */
  const tip = async (loc, html, ms = 4200) => {
    const b = await moveTo(loc);
    if (b) {
      await page.evaluate(
        ([b, html, W, H]) => {
          document.querySelectorAll(".tour-spot").forEach((e) => e.remove());
          const d = document.createElement("div");
          d.className = "tour-spot";
          Object.assign(d.style, {
            left: b.x - 6 + "px",
            top: b.y - 6 + "px",
            width: b.width + 12 + "px",
            height: b.height + 12 + "px",
          });
          document.body.appendChild(d);
          const t = document.getElementById("tour-tip");
          if (!t) return;
          t.innerHTML = html;
          const r = t.getBoundingClientRect();
          const below = b.y + b.height + 18;
          const top = below + r.height < H - 12 ? below : Math.max(60, b.y - r.height - 18);
          const left = Math.min(Math.max(12, b.x + b.width / 2 - r.width / 2), W - r.width - 12);
          Object.assign(t.style, { top: top + "px", left: left + "px" });
        },
        [b, html, W, H],
      );
    }
    await sleep(ms);
    await clearTip();
  };
  /** Full-screen card: eyebrow, title, lines. */
  const card = async (eyebrow, title, lines, ms = 6500) => {
    await page
      .evaluate(
        ([e, t, ls]) => {
          const c = document.getElementById("tour-card");
          if (!c) return;
          c.innerHTML = `<div class="p"><div class="e">${e}</div><div class="t">${t}</div>${ls
            .map((l) => `<div class="l">${l}</div>`)
            .join("")}</div>`;
          c.classList.add("on");
        },
        [eyebrow, title, lines],
      )
      .catch(() => {});
    await sleep(ms);
    await page.evaluate(() => document.getElementById("tour-card")?.classList.remove("on")).catch(() => {});
    await sleep(300);
  };
  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      log("  ! skipped", label, "-", e.message.split("\n")[0]);
      await clearTip();
    }
  };
  const blur = (selector) =>
    page.evaluate((s) => document.querySelectorAll(s).forEach((e) => e.classList.add("tour-blur")), selector).catch(() => {});
  const nav = (name) => page.locator("aside, nav").getByRole("link", { name, exact: true }).first();
  const goNav = async (name, p) => {
    try {
      await click(nav(name), 0);
      await page.waitForURL((u) => u.pathname.startsWith(p), { timeout: 90_000 });
      await settle();
    } catch {
      await go(p);
    }
  };
  const login = async (email, pw, show) => {
    await ctx.clearCookies();
    await go("/login");
    const e = page.locator("input[name=email]");
    const p = page.locator("input[name=password]");
    if (show) {
      await click(e, 150);
      await e.pressSequentially(email, { delay: 35 });
      await click(p, 150);
    } else await e.fill(email);
    await p.fill(pw);
    await click(page.getByRole("button", { name: "Sign in" }), 0);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300_000 });
    await settle();
  };
  /** The export window's first image, once drawn (the window shows "Drawing…" first). */
  const drawn = async () => {
    const img = page.getByRole("dialog").locator("img").first();
    await img.waitFor({ timeout: 120_000 }).catch(() => {});
    waited();
    await sleep(500);
    return img;
  };
  const closeDialog = async () => {
    await page.keyboard.press("Escape");
    await sleep(400);
    const x = page.getByRole("dialog").getByRole("button", { name: "Close" }).first();
    if (await x.isVisible().catch(() => false)) await click(x, 500);
  };

  try {
    // ================= intro =================
    await go("/login");
    await card(
      "Alarm Filter",
      "الوظائف الأساسية… ومين بيعمل إيه",
      [
        "بيقرا ميل الإنذارات لوحده ويصنّفها <b>Down</b> / <b>Power</b> / <b>Other</b>",
        "يقفل الإنذار أول ما الـ<b>Clear</b> يوصل، ويطلّع تقرير الساعة متفلتر",
        "كل دور بيشوف اللي محتاجه بس",
      ],
      6500,
    );
    await card(
      "الأدوار الخمسة",
      "من المتابع لحد صاحب النظام",
      [
        "<b>Viewer</b>: يتابع مكتبه",
        "<b>Operator</b>: مهندس الشيفت في المكتب",
        "<b>Office admin</b>: مسؤول المكتب وناسه ومواقعه",
        "<b>Hotline</b>: يتابع كل المكاتب ويبلّغ الشيفتات",
        "<b>Super admin</b>: القواعد والحسابات لكل المكاتب",
      ],
      7500,
    );

    // ================= operator =================
    const op = made.operator;
    await scene("مهندس الشيفت — Operator");
    await login(op.email, op.pw, true);
    await card("الدور 2 · Operator", "مهندس الشيفت", [
      "يتابع الإنذارات المفتوحة لمكتبه بالأقدم",
      "يعرف بيانات الموقع ويتصل بالحارس",
      "يشغّل ويفلتر تقرير الساعة، ويطلّع صور جاهزة",
    ]);
    if (!page.url().includes("/alarms")) await goNav("Alarms", "/alarms");
    const catTab = (re) => page.getByRole("tab", { name: re }).or(page.getByRole("button", { name: re })).first();
    await safe("tabs", () => tip(catTab(/^All\s*\d/), "تبويبات <b>Down</b> / <b>Power</b> / <b>Other</b> بعدد كل نوع", 4200));
    await safe("down tab", async () => {
      await click(catTab(/^Down\s*\d/), 900);
      await settle();
    });
    await safe("card", () => tip(page.locator("main").getByText(/ on #/).first(), "كارت الإنذار: الموقع والخلية وعمر الإنذار والتاجز (<b>VIP</b> / <b>NODAL</b>)", 5000));
    await safe("call", () => tip(page.locator("main a[href^='tel:']").first(), "اتصال مباشر بحارس الموقع", 3500));
    await safe("search", () => tip(page.getByPlaceholder(/Alarm, site/i).first(), "بحث باسم الإنذار أو الموقع أو الكود", 3500));
    await safe("export", async () => {
      await click(page.getByRole("button", { name: /Export image/ }).first(), 1500);
      await settle();
      const img = await drawn();
      await tip(page.getByRole("dialog").locator("select").first(), "يختار النوع: <b>Down</b> أو <b>Power</b> أو جدول لكل نوع", 4500);
      await tip(img, "صورة جاهزة: موقع في كل سطر بالعمر والنوع", 4500);
      await tip(page.getByRole("dialog").getByRole("button", { name: /Download/ }).first(), "تنزيل الصور — ولو رقم الواتساب مربوط يظهر زرار <b>Send</b>", 4500);
      await closeDialog();
    });

    await goNav("Cleared", "/cleared");
    await scene("مهندس الشيفت — Cleared");
    await safe("cleared", () => tip(page.locator("main").getByText(/ on #/).first(), "الإنذارات اللي اتقفلت ووقت الإصلاح — 50 في الصفحة", 4500));

    await goNav("Hourly Alarms", "/hourly");
    await scene("مهندس الشيفت — Hourly Alarms");
    await safe("hourly list", () => tip(page.locator("main tbody tr").first(), "تقارير الساعة من الميل — 10 في الصفحة", 4000));
    await safe("hourly open", async () => {
      const row = page.locator("main tbody tr").first();
      const proc = row.getByRole("button", { name: /Process|Retry/ });
      if (await proc.isVisible().catch(() => false)) {
        await tip(proc, "<b>Process</b>: يفك الملف ويقرا الإنذارات", 3000);
        await click(proc, 1500);
      }
      const open = row.getByRole("link", { name: /Open/ });
      await open.waitFor({ timeout: 240_000 });
      waited();
      await tip(open, "<b>Open</b>: يفتح التقرير متفلتر لمكتبه", 2500);
      await click(open, 0);
      await page.waitForURL((u) => /\/hourly\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("compare"), { timeout: 180_000 });
      await page.locator("main table").first().waitFor({ timeout: 240_000 }).catch(() => {});
      waited();
      await settle();
    });
    await safe("hourly filters", () => tip(page.getByPlaceholder(/Search/i).first(), "فلترة بالكود والاسم والإنذار والنوع والوقت", 4200));
    await safe("hourly table", () => tip(page.locator("main table").first(), "صفوف ملوّنة بالمكتب وبعمر الإنذار", 4000));
    await safe("hourly image", async () => {
      await click(page.getByRole("button", { name: /Export image/ }).first(), 1500);
      await settle();
      await tip(await drawn(), "صور <b>Down</b> و<b>Environmental</b>، والمكاتب الصغيرة مع بعض في صورة", 5000);
      await tip(page.getByRole("dialog").getByRole("button", { name: "Image settings" }).first(), "الترس: الصور اللي تطلع وإعدادات المشاركة", 3500);
      await closeDialog();
    });

    await goNav("Site Master", "/site-master");
    await scene("مهندس الشيفت — Site Master");
    await safe("sm search", () => tip(page.locator("main input").first(), "بيانات كل المواقع: بحث بالكود أو الاسم أو التليفون", 4000));
    await safe("sm details", async () => {
      await click(page.getByRole("button", { name: /Details/ }).first(), 1200);
      await tip(page.getByRole("dialog").first(), "كل بيانات الموقع: VIP، نودال، مولد، بطاريات، الحارس، الموقع على الخريطة", 5500);
      await closeDialog();
    });

    // ================= office admin =================
    await scene("مسؤول المكتب — Office admin");
    await login(env.DEV_TEST_EMAIL, env.DEV_TEST_PASSWORD, false);
    await card("الدور 3 · Office admin", "مسؤول المكتب", [
      "يعمل حسابات مهندسين الشيفت والمتابعين لمكتبه",
      "يحدّث بيانات مواقع مكتبه (<b>Site Master</b>)",
      "يظبط تقرير الساعة لمكتبه: الإنذارات والصور والألوان",
    ]);
    await go("/settings/users");
    await blur("main table, main ul");
    await safe("users", () => tip(page.locator("main form").first(), "إضافة <b>Operator</b> أو <b>Viewer</b> لمكتبه بس", 4500));
    await go("/settings/hourly");
    await scene("مسؤول المكتب — Alarms, images & colours");
    await safe("h alarms", () => tip(page.getByPlaceholder(/Search name or Alarm Text/).first(), "قايمة كل إنذارات التقرير: تغيير التصنيف أو الإخفاء", 4500));
    await safe("h cat", () => tip(page.locator("main select[aria-label^='Category of']").first(), "تصنيف الإنذار يتغير من هنا", 3500));
    await safe("h sites", () => tip(page.getByRole("button", { name: /Sites/ }).first(), "استثناء مواقع: يظهر أو يختفي في مواقع معينة", 4000));
    await safe("h images", async () => {
      await click(page.getByRole("button", { name: /^Images/ }).first(), 900);
      await tip(page.getByText("Office groups").first(), "<b>Office groups</b>: المكاتب الصغيرة مع بعض في صورة حسب عدد الصفوف", 4500);
    });
    await safe("h colours", async () => {
      await click(page.getByRole("button", { name: /^Colours/ }).first(), 900);
      await tip(page.getByText("Office colours").first(), "لون لكل مكتب، وباقي الصف بدرجة أفتح", 4000);
    });

    // ================= hotline =================
    const hl = made.hotline;
    await scene("الهوت لاين — Hotline");
    await login(hl.email, hl.pw, false);
    await card("الدور 4 · Hotline", "الهوت لاين", [
      "يشوف كل المكاتب، ويختار مكتب أو مجموعة <b>DN</b> / <b>DS</b>",
      "يتابع المفتوح بدل الميل الخام، والكلير بيقفل لوحده",
      "يطلّع صورة لكل مكتب تروح لجروبه",
    ]);
    if (!page.url().includes("/alarms")) await goNav("Alarms", "/alarms");
    await safe("hl nav", () => tip(page.locator("aside nav, nav").first(), "صفحاته: <b>Alarms</b> و<b>Cleared</b> و<b>Dashboard</b> و<b>Settings</b> بس", 4500));
    await safe("hl office", () => tip(page.locator("main select").first(), "فلتر المكتب: كل المكاتب أو مكتب واحد", 4000));
    await safe("hl export", async () => {
      await click(page.getByRole("button", { name: /Export image/ }).first(), 1500);
      await settle();
      await drawn();
      const offices = page.getByRole("dialog").locator("select").nth(3);
      await tip(offices, "<b>One table per office</b>: صورة منفصلة لكل مكتب", 4500);
      await closeDialog();
    });
    await goNav("Dashboard", "/dashboard");
    await scene("الهوت لاين — Dashboard");
    await safe("dash", () => tip(page.locator("main").first(), "الأرقام لكل نوع، وأكتر المواقع، وآخر مزامنة للميل", 4500));

    // ================= super admin =================
    const sa = made.super;
    await scene("صاحب النظام — Super admin");
    await login(sa.email, sa.pw, false);
    await card("الدور 5 · Super admin", "صاحب النظام", [
      "يربط ميل الإنذارات (<b>Gmail</b>)",
      "قواعد التصنيف لكل المكاتب",
      "كل الحسابات والأدوار، ومنها <b>Hotline</b>",
    ]);
    await go("/settings/alarms/classification");
    await scene("صاحب النظام — Classification");
    await safe("rules", () => tip(page.locator("main input").nth(1), "قاعدة: لو اسم الإنذار فيه الكلمة دي يبقى <b>Down</b> أو <b>Power</b> أو <b>Other</b>", 5000));
    await go("/settings/general");
    await scene("صاحب النظام — Office view");
    await safe("office view", () => tip(page.locator("main select").first(), "يختار المكتب اللي يشوفه أو كل المكاتب", 4000));
    await go("/settings/users");
    await blur("main table, main ul");
    await safe("roles", () => tip(page.locator("main form select").first(), "الأدوار: viewer · operator · office admin · hotline · super admin", 5000));

    // ================= outro =================
    await scene("");
    await card(
      "الخلاصة",
      "كل دور بيكسب وقت",
      [
        "<b>Operator</b>: وقته للإصلاح مش للتدوير في الميل",
        "<b>Office admin</b>: مكتب جاهز وبيانات مواقع صح",
        "<b>Hotline</b>: بلاغ منظم لكل المكاتب",
        "<b>Super admin</b>: قواعد واحدة للكل",
      ],
      7000,
    );
  } finally {
    const v = page.video();
    await ctx.close();
    await browser.close();
    // tour accounts + any WhatsApp session folder they got
    for (const a of Object.values(made)) {
      rmSync(path.join(SESSIONS, String(a.id)), { recursive: true, force: true });
    }
    await prisma.user.deleteMany({ where: { email: { in: TOUR.map((a) => a.email) } } });
    if (admin) {
      await prisma.user
        .update({ where: { id: admin.id }, data: { uiPrefs: admin.uiPrefs ?? Prisma.JsonNull } })
        .catch((e) => console.error("could not restore the office admin's prefs:", e));
    }
    await prisma.$disconnect();
    log("tour accounts removed");
    const src = await v.path();
    const dst = path.join(OUT, `${NAME}.webm`);
    rmSync(dst, { force: true });
    rmSync(path.join(OUT, `${NAME}-raw.webm`), { force: true });
    renameSync(src, dst);
    writeFileSync(path.join(OUT, `${NAME}-cuts.json`), JSON.stringify(cuts));
    log("cuts:", cuts.length, "total s:", cuts.reduce((a, [x, y]) => a + y - x, 0).toFixed(1));
    for (const f of readdirSync(RAW)) rmSync(path.join(RAW, f), { force: true });
    rmSync(RAW, { recursive: true, force: true });
    log("video:", dst);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

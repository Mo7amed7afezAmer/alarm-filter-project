// Video tour of the whole web app: drives a headless Chromium with Playwright `recordVideo`,
// injecting an Arabic caption bar, a scene title and a fake cursor into every page.
// Needs the mock dev servers from .claude/launch.json (api-hourly-mock :4110 + web-via-api-mock
// :3310) and DEV_TEST_EMAIL / DEV_TEST_PASSWORD (a SUPER_ADMIN) in apps/web/.env.local.
//   node e2e/tour/tour.mjs            → docs/video/alarm-filter-tour.webm
// The account's office view is switched to "all offices" for the tour (the hourly fixture rows
// are Kafr El Dawar) and restored afterwards; UI prefs touched by the tour are restored too.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, renameSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(path.join(here, "../../.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const BASE = process.env.BASE ?? "http://localhost:3310";
const OUT = path.resolve(here, "../../../../docs/video");
const RAW = path.join(OUT, ".raw");
const W = 1440;
const H = 900;
const SPEED = Number(process.env.TOUR_SPEED ?? 1); // < 1 = faster (for dry runs)

// ---------- overlay injected into every document ----------
const overlay = () => {
  const css = `
  #tour-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;
    max-width:1180px;width:max-content;padding:16px 28px;border-radius:14px;
    background:rgba(8,12,24,.88);color:#fff;font:600 25px/1.55 "Segoe UI",Tahoma,Arial,sans-serif;
    direction:rtl;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15);
    transition:opacity .25s}
  #tour-cap:empty{opacity:0}
  #tour-cap b{color:#5eead4;font-weight:700;unicode-bidi:isolate;direction:ltr;display:inline-block}
  #tour-scene{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483646;
    padding:6px 18px;border-radius:999px;background:#0d9488;color:#fff;
    font:700 17px/1.4 "Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;box-shadow:0 4px 14px rgba(0,0,0,.35)}
  #tour-scene:empty{display:none}
  #tour-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(250,204,21,.55);border:2px solid #facc15;pointer-events:none;
    transition:left .6s ease,top .6s ease,transform .15s}
  #tour-cursor.down{transform:scale(.6)}
  .tour-spot{position:fixed;z-index:2147483645;border:3px solid #facc15;border-radius:10px;pointer-events:none;
    box-shadow:0 0 0 5px rgba(250,204,21,.28),0 0 18px rgba(250,204,21,.45)}`;
  const mount = () => {
    if (document.getElementById("tour-cap")) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    for (const id of ["tour-cap", "tour-scene", "tour-cursor"]) {
      const d = document.createElement("div");
      d.id = id;
      document.body.appendChild(d);
    }
    const s = JSON.parse(sessionStorage.getItem("tour") || "{}");
    document.getElementById("tour-cap").innerHTML = s.cap || "";
    document.getElementById("tour-scene").textContent = s.scene || "";
    const c = document.getElementById("tour-cursor");
    c.style.left = (s.x ?? 720) + "px";
    c.style.top = (s.y ?? 450) + "px";
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));

async function main() {
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: RAW, size: { width: W, height: H } },
    acceptDownloads: true,
    locale: "en-US",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  // video time ≈ wall time since the page opened; slow `next dev` loads are cut out afterwards
  const t0 = Date.now();
  const cuts = [];
  let mark = t0;
  page.setDefaultTimeout(60_000);
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  // ---------- helpers ----------
  const state = async (patch) =>
    page.evaluate((p) => {
      const s = { ...JSON.parse(sessionStorage.getItem("tour") || "{}"), ...p };
      sessionStorage.setItem("tour", JSON.stringify(s));
      const cap = document.getElementById("tour-cap");
      const sc = document.getElementById("tour-scene");
      if (cap && "cap" in p) cap.innerHTML = p.cap;
      if (sc && "scene" in p) sc.textContent = p.scene;
    }, patch).catch(() => {});
  /** Caption (Arabic; English UI terms in <b>…</b>), kept on screen for `ms`. */
  const cap = async (html, ms = 4500) => {
    await state({ cap: html });
    await sleep(ms);
  };
  const scene = async (title) => {
    log("scene:", title);
    await state({ scene: title, cap: "" });
  };
  /** Everything between the last action and now longer than ~3 s is dead time → cut list. */
  const waited = () => {
    const now = Date.now();
    if (now - mark > 3000) cuts.push([(mark - t0 + 900) / 1000, (now - t0 - 200) / 1000]);
    mark = now;
  };
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    waited();
    await sleep(800);
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
    await sleep(700);
    return b;
  };
  const press = async () => {
    await page.evaluate(() => document.getElementById("tour-cursor")?.classList.add("down")).catch(() => {});
    await sleep(180);
    await page.evaluate(() => document.getElementById("tour-cursor")?.classList.remove("down")).catch(() => {});
  };
  const click = async (loc, after = 1200, opts = {}) => {
    const t = Date.now();
    await moveTo(loc);
    const t1 = Date.now();
    await press();
    await loc.click({ timeout: 15_000, ...opts });
    if (process.env.TOUR_DEBUG) log(`  click move=${t1 - t}ms click=${Date.now() - t1}ms`);
    mark = Date.now();
    await sleep(after);
  };
  /** Outline an element (dims the rest) while a caption is read. */
  const spot = async (loc, html, ms = 4500) => {
    const b = await moveTo(loc);
    if (b) {
      await page.evaluate((b) => {
        document.querySelectorAll(".tour-spot").forEach((e) => e.remove());
        const d = document.createElement("div");
        d.className = "tour-spot";
        Object.assign(d.style, {
          left: b.x - 6 + "px", top: b.y - 6 + "px", width: b.width + 12 + "px", height: b.height + 12 + "px",
        });
        document.body.appendChild(d);
      }, b);
    }
    await cap(html, ms);
    await page.evaluate(() => document.querySelectorAll(".tour-spot").forEach((e) => e.remove())).catch(() => {});
  };
  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      log("  ! skipped", label, "-", e.message.split("\n")[0]);
      await page.evaluate(() => document.querySelectorAll(".tour-spot").forEach((e) => e.remove())).catch(() => {});
    }
  };
  const scroll = async (dy, ms = 1500) => {
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.wheel(0, dy);
    await sleep(ms);
  };
  const api = (method, p, data) =>
    page.request.fetch(BASE + p, { method, data, headers: data ? { "content-type": "application/json" } : {} });
  const download = async (loc, what) => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), click(loc, 300, { noWaitAfter: true })]);
    await cap(`تم تنزيل ${what}: <b>${d.suggestedFilename()}</b>`, 3500);
  };
  const goNav = async (name, p) => {
    try {
      await click(nav(name), 0);
      await page.waitForURL((u) => u.pathname.startsWith(p), { timeout: 60_000 });
      await settle();
    } catch {
      await go(p);
    }
  };
  const goSide = async (name, p) => {
    try {
      await click(side(name), 0);
      await page.waitForURL((u) => u.pathname.startsWith(p), { timeout: 60_000 });
      await settle();
    } catch {
      await go(p);
    }
  };
  const nav = (name) => page.locator("aside, nav").getByRole("link", { name, exact: true }).first();
  const side = (name) => page.getByRole("link", { name, exact: true }).first();

  // ================= 1. Intro + login =================
  await go("/login");
  await scene("مقدمة");
  await cap("أهلاً بك في جولة على برنامج <b>Alarm Filter</b> — نظام قراءة إيميلات الألارم من <b>Gmail</b> وتصنيفها ومتابعتها", 6000);
  await cap("البرنامج بيقرأ الإيميلات كل دقيقة، يصنّف كل ألارم (<b>Down</b> / <b>Power</b> / <b>Other</b>) ويربطه بإيميل الـ<b>Clear</b> بتاعه", 6500);
  await scene("تسجيل الدخول — Login");
  const email = page.locator("input[name=email]");
  await spot(page.locator("form"), "صفحة <b>Login</b>: كل مستخدم بيدخل بالإيميل والباسورد اللي الأدمن عمله له", 4500);
  await click(email, 200);
  await email.pressSequentially(env.DEV_TEST_EMAIL, { delay: 45 });
  const pw = page.locator("input[name=password]");
  await click(pw, 200);
  await pw.fill(env.DEV_TEST_PASSWORD);
  await cap("نكتب الإيميل والباسورد ونضغط <b>Sign in</b>", 2500);
  await click(page.getByRole("button", { name: "Sign in" }), 0);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300_000 });
  await settle();

  if (process.env.TOUR_STOP === "login") throw new Error("stop after login");
  // the hourly fixture belongs to Kafr El Dawar → view all offices during the tour
  const cur = await (await api("GET", "/api/settings/office")).json().catch(() => ({}));
  const originalOffice = cur && "office" in cur ? cur.office : "DN/Damanhour";
  await api("PUT", "/api/settings/office", { office: null });
  const prefsBefore = await (await api("GET", "/api/me/ui-prefs")).json().catch(() => null);
  log("office was", originalOffice);

  try {
    // ================= 2. Navigation =================
    await go("/alarms");
    await scene("القائمة الجانبية");
    await spot(page.locator("aside").first(), "القائمة الجانبية فيها كل الصفحات: <b>Alarms</b> و<b>Cleared</b> و<b>Dashboard</b> و<b>Hourly Alarms</b> و<b>Settings</b>", 6000);

    // ================= 3. Active alarms =================
    await scene("الألارمات النشطة — Active alarms");
    await spot(page.getByRole("heading", { name: /Active alarms/ }).first(), "صفحة <b>Active alarms</b>: كل الألارمات اللي لسه ما جالهاش <b>Clear</b>، والرقم جنب العنوان هو العدد", 5500);
    await safe("table", () => spot(page.locator("table").first(), "كل صف = ألارم: الاسم، الموقع (<b>Site</b>)، التصنيف، وقت الألارم (<b>Raised</b>) وعمود <b>Age</b> اللي بيعدّ مدة الألارم لحظة بلحظة", 6500));
    await safe("alert rows", async () => {
      const red = page.locator("tbody tr.bg-red-50\\/70").first();
      if (await red.count()) await spot(red, "الصفوف اللي عدّت <b>4 hours</b> (قيمة <b>ALERT_HOURS</b>) بتتلوّن بالأحمر عشان تاخد بالك منها", 5500);
      else await cap("الصفوف اللي عدّت <b>4 hours</b> (قيمة <b>ALERT_HOURS</b>) بتتلوّن بالأحمر عشان تاخد بالك منها", 5000);
    });
    await safe("site master cols", () =>
      spot(page.locator("thead").first(), "من الـ<b>Site Master</b> بيظهر لكل موقع: علامة <b>VIP</b> و<b>Nodality</b> و<b>Battery</b> ورقم الحارس <b>Phone</b> (تضغط عليه فيتصل)", 6500),
    );
    await scene("الفلاتر — Filters");
    await safe("category", async () => {
      const trigger = page.getByRole("combobox").first();
      await click(trigger, 1000);
      await click(page.getByRole("option", { name: "Down", exact: true }), 1500);
      await cap("فلتر التصنيف: نختار <b>Down</b> فيظهر بس ألارمات وقوع المواقع — والفلتر بيتحفظ في الـ<b>URL</b> فتقدر تبعت اللينك لزميلك", 6000);
      await click(trigger, 800);
      await click(page.getByRole("option", { name: "All", exact: true }), 1000);
    });
    await safe("site filter", async () => {
      const site = page.getByPlaceholder("e.g. SK-ADLIYA");
      await click(site, 200);
      await site.pressSequentially("BH", { delay: 120 });
      await cap("فلتر <b>Site</b>: اكتب جزء من اسم الموقع أو الكود، ومعاه فلتر <b>Region</b>", 4500);
      await site.fill("");
    });
    await safe("older than", async () => {
      const sel = page.locator("select").filter({ hasText: "Any age" }).first();
      await moveTo(sel);
      await sel.selectOption({ label: "1 hour" });
      await cap("<b>Older than</b>: يعرض بس الألارمات اللي عدّت مدة معيّنة (ساعة، 4 ساعات، يوم، 3 أيام)", 5000);
      await sel.selectOption({ label: "Any age" });
      await sleep(800);
    });
    await safe("refresh/export", async () => {
      await spot(page.getByRole("button", { name: "Refresh" }), "الصفحة بتعمل تحديث تلقائي كل دقيقة، وزرار <b>Refresh</b> للتحديث فوراً", 4000);
      await download(page.getByRole("link", { name: "Export" }).first(), "ملف Excel للألارمات النشطة");
    });

    // ================= 4. Cleared =================
    await goNav("Cleared", "/cleared");
    await scene("الألارمات المقفولة — Cleared alarms");
    await spot(page.getByRole("heading", { name: /Cleared alarms/ }).first(), "صفحة <b>Cleared alarms</b>: الألارمات اللي جالها <b>Clear</b> ومعاها مدة الألارم", 5000);
    await safe("dates", () => spot(page.locator("input[type=date], input[type=datetime-local]").first().locator(".."), "تختار الفترة من <b>From</b> إلى <b>To</b> (الافتراضي آخر يومين)", 5000));
    await safe("table", () => spot(page.locator("table").first(), "عمود <b>Duration</b> = وقت الـ<b>Clear</b> ناقص وقت الألارم، وبادج <b>Clear type</b>: <b>EMAIL</b> (جاله إيميل Clear) أو <b>AUTO_SUPERSEDED</b> (اتقفل لأن نفس الألارم اتكرر بوقت أحدث)", 7500));
    await safe("pager", () => spot(page.getByRole("button", { name: "Next" }), "الجدول مقسّم صفحات بـ<b>Prev</b> / <b>Next</b>", 3500));
    await safe("export", () => download(page.getByRole("link", { name: "Export" }).first(), "ملف Excel للألارمات المقفولة بنفس الفلاتر"));

    // ================= 5. Dashboard =================
    await goNav("Dashboard", "/dashboard");
    await sleep(1500);
    await scene("لوحة الإحصائيات — Dashboard");
    await safe("counters", () => spot(page.getByRole("link", { name: /Active · Down/ }).first().locator(".."), "العدادات: الألارمات النشطة لكل تصنيف (<b>Down</b> / <b>Power</b> / <b>Other</b>)، اللي أقدم من <b>4h</b>، والمقفول في آخر <b>24h</b> — وكل عداد لينك للصفحة بالفلتر", 7500));
    await safe("chart", () => spot(page.getByRole("heading", { name: /Alarms raised per day/ }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]"), "رسم بياني لعدد الألارمات كل يوم في آخر <b>30 days</b> مقسّم حسب التصنيف", 5500));
    await safe("top sites", () => spot(page.getByRole("heading", { name: /Top 10 sites/ }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]"), "<b>Top 10 sites</b>: أكتر المواقع اللي عليها ألارمات في آخر 30 يوم", 5000));
    await safe("mttr", async () => {
      const m = page.getByText(/MTTR/).first();
      await spot(m.locator(".."), "<b>MTTR</b> = متوسط مدة الإصلاح لكل تصنيف (من الـ<b>Clears</b> اللي جت بإيميل بس)", 5500);
    });
    await safe("sync", async () => {
      const s = page.getByText(/sync/i).first();
      await spot(s.locator(".."), "حالة المزامنة: <b>last sync X min ago</b> — بتبقى حمرا لو عدّى أكتر من 5 دقايق أو فيه خطأ من Gmail", 5500);
    });

    // ================= 6. Notifications bell =================
    await scene("الإشعارات — Notifications");
    await safe("bell", async () => {
      const bell = page.getByRole("button", { name: /notifications|Notifications/ }).first();
      await spot(bell, "الجرس فيه عدد الإشعارات الجديدة: كل ألارم جديد يطابق تفضيلاتك (الافتراضي <b>DOWN</b> بس) — بصوت وكارت منبثق", 6000);
      await click(bell, 2500);
      await cap("القائمة بتعرض ألارمات آخر 24 ساعة، و<b>Mark all read</b> يعلّمها مقروءة، وأيقونة الترس تفتح إعدادات الإشعارات", 6000);
      await page.keyboard.press("Escape");
      await click(bell, 800);
    });

    // ================= 7. Hourly reports =================
    await goNav("Hourly Alarms", "/hourly");
    await scene("التقارير الساعية — Hourly Alarms");
    await spot(page.locator("table").first(), "صفحة <b>Hourly Alarms</b>: إيميلات تقرير نوكيا كل ساعة (ملف <b>.rar</b> أو <b>.xlsx</b>) — الوقت، المرسل، اسم الملف والحجم", 6500);
    await cap("التقارير مش بتتخزن في الداتابيز: بتتعالج عند الطلب في الذاكرة وتفضل جاهزة <b>30 min</b>", 5000);
    const processBtn = page.getByRole("button", { name: "Process", exact: true }).first();
    let gmailId = null;
    await safe("process", async () => {
      await click(processBtn, 500);
      await cap("زرار <b>Process</b>: ينزّل المرفق، يفك الضغط، يقرأ الشيتات ويربطها بالـ<b>Site Master</b>", 4000);
      await page.getByRole("link", { name: "Open" }).first().waitFor({ timeout: 180_000 });
      waited();
      await sleep(800);
    });
    await safe("process 2nd", async () => {
      // the second report is needed for "Compare with previous"
      if (await page.getByRole("button", { name: "Process", exact: true }).count()) {
        await page.getByRole("button", { name: "Process", exact: true }).first().click();
        await page.getByRole("link", { name: "Open" }).nth(1).waitFor({ timeout: 180_000 });
        waited();
      }
    });
    await safe("open", async () => {
      const open = page.getByRole("link", { name: "Open" }).first();
      gmailId = decodeURIComponent((await open.getAttribute("href")).split("/").pop());
      await spot(open, "بعد المعالجة يظهر زرار <b>Open</b> لعرض النتيجة (وفيه <b>Process latest</b> لأحدث تقرير)", 4000);
      await click(open, 0);
      await page.getByTestId("row-count").waitFor({ timeout: 180_000 });
      waited();
      await settle();
    });

    // ================= 8. Hourly results =================
    await scene("نتيجة التقرير — Hourly report");
    await safe("tabs", () => spot(page.getByRole("tablist", { name: "Sheet" }), "تبويبات الشيتات: <b>All sheets</b> و<b>2G/3G/4G/5G Down</b> و<b>Environmental</b> و<b>HW</b> وجنب كل واحد عدد الصفوف", 6000));
    await safe("tab 4g", async () => {
      await click(page.getByRole("tab", { name: /4G Down/ }), 1500);
      await click(page.getByRole("tab", { name: /Environmental/ }), 2000);
      await click(page.getByRole("tab", { name: /All sheets/ }), 1200);
    });
    await safe("filters", () => spot(page.getByRole("tablist", { name: "Sheet" }).locator(".."), "الفلاتر: <b>Office</b> و<b>Alarm</b> و<b>Region</b> و<b>Site type</b> و<b>Category</b> و<b>VIP</b> ووقت الألارم من/إلى، وبحث بالكود أو الاسم", 6500));
    await safe("search", async () => {
      const q = page.getByPlaceholder("e.g. 3273DE or BH-6");
      await click(q, 200);
      await q.pressSequentially("DE", { delay: 150 });
      await sleep(1500);
      await cap("مثال: بحث بالكود — والجدول بيتفلتر فوراً. <b>Clear filters</b> يرجّع كل حاجة", 4500);
      const clr = page.getByRole("button", { name: "Clear filters" });
      if (await clr.count()) await click(clr, 1200);
    });
    await safe("table", () => spot(page.locator("table").first(), "ألوان الصفوف حسب المكتب (<b>Office</b>)، والصفوف القديمة بتتلوّن بـ<b>age colours</b> (الافتراضي: أحمر بعد 3 ساعات من وقت التقرير)", 6500));
    await safe("site#", async () => {
      const h = page.locator("thead th").filter({ hasText: /Site #/ }).first();
      if (await h.count()) await spot(h, "عمود <b>Site #</b> بيرقّم المواقع 1، 2، 3… — آخر رقم = عدد المواقع، وفيه كمان عدد ألارمات كل موقع", 5500);
    });
    await safe("count", () => spot(page.getByTestId("row-count"), "تحت الجدول: عدد الصفوف المعروضة وعدد المواقع، والأكواد اللي مش موجودة في الـ<b>Site Master</b>", 5000));
    await safe("columns", async () => {
      const b = page.getByRole("button", { name: /Columns/ }).first();
      await click(b, 1500);
      await cap("<b>Columns</b>: تختار الأعمدة اللي تظهر في الجدول والـExcel والـPDF — وبتتحفظ لحسابك", 5000);
      await click(b, 800);
    });
    await safe("copy", async () => {
      await click(page.getByRole("button", { name: "Copy as table" }), 1500);
      await cap("<b>Copy as table</b>: ينسخ الجدول بالألوان فتلصقه في إيميل أو Excel على طول", 4500);
    });
    await safe("image", async () => {
      await click(page.getByTestId("table-image"), 2500);
      await cap("<b>Image for WhatsApp</b>: يحوّل الجدول لصور جاهزة للإرسال — مقسّمة حسب التصنيف، وتختار عدد الصفوف في كل صورة", 6500);
      await scroll(400, 1500);
      await cap("من هنا <b>Download</b> (أو <b>Share</b> على الموبايل مع HTTPS)", 4000);
      await click(page.getByRole("dialog").getByRole("button", { name: "Close" }), 1000);
    });
    await safe("pdf", () => download(page.getByRole("button", { name: /PDF/ }).first(), "ملف PDF بنفس الجدول والألوان"));
    await safe("excel", () => download(page.getByTestId("export-excel"), "ملف Excel (شيت لكل تصنيف)"));

    // ================= 9. Compare =================
    await safe("compare", async () => {
      const c = page.getByRole("link", { name: "Compare with previous" });
      await spot(c, "<b>Compare with previous</b>: يقارن التقرير ده بالتقرير اللي قبله", 4000);
      await click(c, 0);
      await settle();
      await page.waitForTimeout(4000);
      await scene("مقارنة تقريرين — Compare");
      await cap("صفحة <b>Compare</b>: تعرض الألارمات الجديدة (<b>new</b>) واللي اختفت (<b>disappeared</b>) بين التقريرين", 6500);
      await scroll(500, 2500);
      await scroll(-500, 800);
    });

    // ================= 10. Settings =================
    await goNav("Settings", "/settings");
    await scene("الإعدادات — General");
    await spot(page.locator("main nav, main aside").first(), "<b>Settings</b> ليها قائمة أقسام — كل مستخدم بيشوف الأقسام المسموح له بيها حسب الـ<b>role</b>", 5500);
    await safe("theme", async () => {
      await spot(page.getByRole("button", { name: /Blue/ }).first().locator(".."), "<b>General</b>: اختيار الثيم — <b>Blue</b> (الافتراضي) أو <b>Dark</b> أو <b>Light</b>", 4500);
      await click(page.getByRole("button", { name: /^Light/ }).first(), 2500);
      await click(page.getByRole("button", { name: /^Dark/ }).first(), 2500);
      await click(page.getByRole("button", { name: /^Blue/ }).first(), 1500);
    });

    await goSide("Notifications", "/settings/notifications");
    await scene("الإعدادات — Notifications");
    await cap("<b>Notifications</b>: تشغيل/إيقاف الإشعارات والصوت، واختيار التصنيفات وأسماء الألارم والمواقع اللي عايز يجيلك عنها إشعار", 7000);
    await scroll(500, 2500);
    await scroll(-500, 500);

    await goSide("Display alarms", "/settings/alarms/display");
    await scene("الإعدادات — Display alarms");
    await cap("<b>Display alarms</b>: شكل صفحات Alarms و Cleared لحسابك — إخفاء أعمدة، وعرض <b>VIP</b>/<b>Nodality</b>/<b>Battery</b> كأيقونات", 6500);
    await safe("group", async () => {
      const t = page.getByText("One row per site code").first();
      await spot(t.locator("xpath=ancestor::label[1]"), "<b>One row per site code</b>: يجمّع ألارمات نفس الموقع في صف واحد — نجرّبه", 4500);
      await click(t, 1500);
      await goNav("Alarms", "/alarms");
      await scene("التجميع حسب الموقع");
      await cap("دلوقتي كل موقع في صف واحد مع عدد الألارمات — اضغط على الصف يفتح التفاصيل", 4500);
      const row = page.locator("tbody tr").first();
      await click(row, 2500);
      await cap("وده بيفيد لما موقع واحد يكون عليه ألارمات كتير", 3500);
      await go("/settings/alarms/display");
      await click(page.getByText("One row per site code").first(), 1200);
    });
    await safe("hidden types", async () => {
      await scroll(900, 1500);
      await cap("وتحت: إخفاء أنواع ألارم معيّنة من صفحاتك أنت بس (<b>Hide</b>)، والأدمن يقدر يخفيها لكل المستخدمين", 6000);
    });

    await goSide("Classification", "/settings/alarms/classification");
    await scene("الإعدادات — Classification");
    await cap("<b>Classification rules</b>: الكلمات اللي بتحدد تصنيف الألارم — أول قاعدة تطابق اسم الألارم حسب الترتيب هي اللي بتكسب", 6500);
    await safe("rules", () => spot(page.locator("main input").first().locator("xpath=ancestor::*[self::li or self::tr or contains(@class,'flex')][1]"), "كل قاعدة: نص (<b>pattern</b>) + تصنيف <b>DOWN</b>/<b>POWER</b>/<b>OTHER</b>، و<b>+ Add rule</b> ثم <b>Save rules</b> يعيد تصنيف الألارمات الموجودة", 6500));

    await goSide("Table, images & files", "/settings/hourly");
    await scene("الإعدادات — Hourly reports");
    await cap("إعدادات <b>Hourly reports</b>: إخفاء شيتات أو تصنيفات أو أسماء ألارم من الجدول وكل الملفات المصدّرة", 6000);
    await scroll(600, 2000);
    await cap("ترتيب الأعمدة لـ<b>Table, Excel & PDF</b> وللـ<b>WhatsApp images</b> بأسهم فوق/تحت، و<b>sort by site code</b>", 6000);
    await scroll(900, 2000);
    await cap("<b>Age colours</b>: لون لكل عدد ساعات (للصف كله أو أعمدة معيّنة)، و<b>Split</b>: تقسيم الصور والـExcel والـPDF حسب التصنيف أو المكتب", 7000);
    await scroll(-1500, 600);

    await goSide("Users & roles", "/settings/users");
    await scene("الإعدادات — Users & roles");
    await cap("<b>Users & roles</b>: إضافة مستخدمين وتحديد الصلاحية والمكتب، و<b>Reset password</b> و<b>Delete</b>", 6000);
    await cap("الصلاحيات: <b>viewer</b> (مشاهدة) < <b>operator</b> (يعالج التقارير) < <b>office admin</b> (يدير مستخدمي مكتبه) < <b>super admin</b> (كل حاجة)", 7500);

    // Office view and Reprocess are cards on Settings → General (2026-10-25).
    await goSide("General", "/settings/general");
    await scene("الإعدادات — Office view");
    await safe("office", () => spot(page.locator("main select").first(), "<b>Office view</b> (للـ<b>super admin</b>): تختار المكتب اللي تشوف بياناته أو <b>All offices</b>، وكل مستخدم تاني بيشوف مكتبه بس", 6500));

    await scroll(1500, 600);
    await scene("الإعدادات — Reprocess");
    await cap("<b>Reprocess</b>: يعيد بناء الألارمات من الإيميلات المخزّنة لعدد أيام تختاره (مثلاً بعد تعديل القواعد) — <b>Queue reprocess</b> والـworker بينفّذ", 7000);

    await goSide("Gmail connection", "/settings/gmail");
    await scene("الإعدادات — Gmail connection");
    await cap("<b>Gmail connection</b>: حالة ربط حساب Gmail، و<b>Test connection</b>، و<b>Reconnect / switch account</b>، ورفع <b>credentials.json</b>", 7000);

    await goSide("Site Master", "/settings/site-master");
    await scene("الإعدادات — Site Master");
    await safe("sm import", () => spot(page.getByRole("button", { name: "Import" }).first(), "<b>Site Master</b>: رفع ملف Excel بيانات المواقع (المكتب، <b>Nodality</b>، <b>VIP</b>، النوع، البطارية، رقم الحارس) — <b>Import</b>", 6000));
    await scroll(500, 2000);
    await cap("الجدول يعرض المواقع ويقدر الأدمن يعدّل رقم التليفون، وتحت قواعد تصحيح الكتابة (<b>normalization</b>) زي <b>SHELTER DOO → SHELTER DOOR</b>", 7000);
    await scroll(-500, 500);

    // ================= 11. Outro =================
    await scene("الخاتمة");
    await cap("وأخيراً <b>Sign out</b> من أسفل القائمة الجانبية", 3500);
    await safe("signout", () => spot(page.getByRole("button", { name: "Sign out" }).first(), "خروج من الحساب", 2500));
    await cap("ده كان شرح كل صفحات <b>Alarm Filter</b> — شكراً للمشاهدة", 5000);
  } finally {
    // restore the account
    await api("PUT", "/api/settings/office", { office: originalOffice }).catch(() => {});
    if (prefsBefore) {
      await api("PUT", "/api/me/ui-prefs", prefsBefore.prefs).catch(() => {});
    }
    log("restored office", originalOffice);
    const v = page.video();
    await ctx.close();
    await browser.close();
    const src = await v.path();
    const dst = path.join(OUT, "alarm-filter-tour.webm");
    rmSync(dst, { force: true });
    renameSync(src, dst);
    writeFileSync(path.join(OUT, "cuts.json"), JSON.stringify(cuts));
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

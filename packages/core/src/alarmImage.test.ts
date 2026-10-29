import { describe, expect, it } from "vitest";
import {
  categoryMark,
  DEFAULT_ALARM_IMAGE_PREFS,
  normalizeAlarmImagePrefs,
  shortSite,
  siteImageGroups,
  siteImageRows,
  sortSiteRows,
  visibleSiteRows,
  whatsappNumber,
  shownAlarmCount,
  ALARM_IMAGE_CATEGORIES,
  choiceCategories,
  imageCategoryOf,
  sitesWithCategories,
  shownCategories,
  withShownTime,
  whatsappTarget,
  whatsappUrl,
  type ImageAlarm,
} from "./alarmImage.js";
import { normalizeUiPrefs } from "./uiPrefs.js";

const alarm = (o: Partial<ImageAlarm>): ImageAlarm => ({
  site: "451_S_BH-KOM-AZIZA_0D36DE",
  siteCode: "0D36DE",
  category: "DOWN",
  alarmName: "BTS O&M LINK FAILURE",
  alarmTime: "2026-10-26T08:00:00.000Z",
  office: "DN/Kafr ElDawar",
  vip: null,
  nodality: null,
  battery: null,
  powerSource: null,
  phone: null,
  ...o,
});

describe("shortSite", () => {
  it("keeps the site name with its code", () => {
    expect(shortSite("451_S_BH-KOM-AZIZA_0D36DE")).toBe("BH-KOM-AZIZA_0D36DE");
    expect(shortSite("SRAN_LWG_TDD_S_BH-QMB-LOQIN_0H31DE")).toBe("BH-QMB-LOQIN_0H31DE");
    expect(shortSite("BH-MADIA-RASHD_0342DE")).toBe("BH-MADIA-RASHD_0342DE");
  });
});

describe("siteImageRows", () => {
  it("folds a site's alarms into one row with counts per category, oldest time first", () => {
    const rows = siteImageRows([
      alarm({ alarmTime: "2026-10-26T09:00:00.000Z" }),
      alarm({ alarmTime: "2026-10-26T07:00:00.000Z", alarmName: "WCDMA CELL OUT OF USE" }),
      alarm({ category: "POWER", alarmName: "MAINS FAILURE" }),
      alarm({
        site: "S_BH-MADIA-RASHD_0342DE",
        siteCode: "0342DE",
        alarmTime: "2026-10-26T06:00:00.000Z",
      }),
    ]);
    expect(rows.map((r) => r.site)).toEqual(["BH-MADIA-RASHD_0342DE", "BH-KOM-AZIZA_0D36DE"]);
    expect(rows[1]).toMatchObject({
      alarmTime: "2026-10-26T07:00:00.000Z",
      counts: { DOWN: 2, POWER: 1, OTHER: 0 },
      alarmNames: ["BTS O&M LINK FAILURE", "WCDMA CELL OUT OF USE", "MAINS FAILURE"],
    });
    expect(rows[0]!.counts).toEqual({ DOWN: 1, POWER: 0, OTHER: 0 });
  });

  it("uses the site when there is no site code", () => {
    const rows = siteImageRows([alarm({ siteCode: null }), alarm({ siteCode: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.counts.DOWN).toBe(2);
  });
});

describe("siteImageGroups", () => {
  const rows = siteImageRows([
    alarm({}),
    alarm({ site: "S_X_0001DE", siteCode: "0001DE", office: "DN/Tanta" }),
    alarm({ site: "S_Y_0002DE", siteCode: "0002DE", office: null }),
  ]);
  it("puts every office in one table by default", () => {
    expect(siteImageGroups(rows, false)).toEqual([{ label: "", rows }]);
  });
  it("splits per office, named by the last label segment", () => {
    expect(siteImageGroups(rows, true).map((g) => [g.label, g.rows.length])).toEqual([
      ["Kafr ElDawar", 1],
      ["No office", 1],
      ["Tanta", 1],
    ]);
  });
});

describe("categoryMark", () => {
  it("is empty, a tick, or a tick with the count", () => {
    expect([0, 1, 3].map(categoryMark)).toEqual(["", "✓", "✓ 3"]);
  });
});

describe("normalizeAlarmImagePrefs", () => {
  it("defaults to time, site, age, down, power in one table", () => {
    expect(normalizeAlarmImagePrefs(undefined)).toEqual(DEFAULT_ALARM_IMAGE_PREFS);
    expect(DEFAULT_ALARM_IMAGE_PREFS.columns).toEqual(["time", "site", "age", "down", "power"]);
    expect(normalizeUiPrefs({}).alarms.image).toEqual(DEFAULT_ALARM_IMAGE_PREFS);
  });
  it("keeps the column order fixed, drops unknown ids and always keeps the site", () => {
    expect(
      normalizeAlarmImagePrefs({
        columns: ["other", "bogus", "time"],
        byOffice: true,
        rowsPerImage: 60,
      }),
    ).toEqual({
      columns: ["time", "site", "other"],
      byOffice: true,
      rowsPerImage: 60,
      sort: "oldest",
      officeColors: {},
      shareAll: "",
      shareOffices: {},
      shareMode: "all",
    });
    expect(normalizeAlarmImagePrefs({ rowsPerImage: 7 }).rowsPerImage).toBe(40);
  });
});

describe("visibleSiteRows / sortSiteRows", () => {
  const rows = siteImageRows([
    alarm({ site: "S_A_0001DE", siteCode: "0001DE", alarmTime: "2026-10-26T01:00:00.000Z" }),
    alarm({ site: "S_A_0001DE", siteCode: "0001DE", alarmTime: "2026-10-26T01:00:00.000Z" }),
    alarm({ site: "S_B_0002DE", siteCode: "0002DE", category: "OTHER" }),
    alarm({
      site: "S_C_0003DE",
      siteCode: "0003DE",
      category: "POWER",
      alarmTime: "2026-10-26T03:00:00.000Z",
    }),
    alarm({
      site: "S_D_0004DE",
      siteCode: "0004DE",
      alarmTime: "2026-10-26T09:00:00.000Z",
    }),
  ]);
  const sites = (r: { site: string }[]) => r.map((x) => x.site);

  it("leaves out sites whose only alarms are in a hidden category column", () => {
    expect(sites(visibleSiteRows(rows, ["time", "site", "age", "down", "power"]))).toEqual([
      "A_0001DE",
      "C_0003DE",
      "D_0004DE",
    ]);
    expect(sites(visibleSiteRows(rows, ["site", "other"]))).toEqual(["B_0002DE"]);
    expect(visibleSiteRows(rows, ["site", "age"])).toHaveLength(4);
  });

  it("sorts oldest / newest / down / power first / by site", () => {
    expect(sites(sortSiteRows(rows, "oldest"))).toEqual([
      "A_0001DE",
      "C_0003DE",
      "B_0002DE",
      "D_0004DE",
    ]);
    expect(sites(sortSiteRows(rows, "newest"))).toEqual([
      "D_0004DE",
      "B_0002DE",
      "C_0003DE",
      "A_0001DE",
    ]);
    expect(sites(sortSiteRows(rows, "down"))[0]).toBe("A_0001DE");
    expect(sites(sortSiteRows(rows, "power"))[0]).toBe("C_0003DE");
    expect(sites(sortSiteRows(rows, "site"))).toEqual([
      "A_0001DE",
      "B_0002DE",
      "C_0003DE",
      "D_0004DE",
    ]);
  });
});

describe("VIP / Nodal columns and office order", () => {
  it("VIP = YES / NO, Nodal = the Site Master nodality; mail labels when Site Master is silent", () => {
    const rows = siteImageRows([
      alarm({ nodality: "1+2", vip: true }),
      alarm({ site: "S_BH-Z_0003DE", siteCode: "0003DE", nodality: "1+0", vip: false }),
      alarm({ site: "S_BH-X_0001DE", siteCode: "0001DE", labels: ["NODAL", "VIP"] }),
      alarm({ site: "S_BH-Y_0002DE", siteCode: "0002DE" }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect([by["0D36DE"]!.vip, by["0D36DE"]!.nodal]).toEqual(["YES", "1+2"]);
    expect([by["0003DE"]!.vip, by["0003DE"]!.nodal]).toEqual(["NO", "1+0"]);
    expect([by["0001DE"]!.vip, by["0001DE"]!.nodal]).toEqual(["YES", "NODAL"]);
    // not in Site Master, no labels → unknown
    expect([by["0002DE"]!.vip, by["0002DE"]!.nodal]).toEqual(["", ""]);
  });

  it("keeps valid office colours and the old WhatsApp number as the all-images chat", () => {
    const p = normalizeAlarmImagePrefs({
      officeColors: { "Kafr ElDawar": "#BBF7D0", Tanta: "red", " ": "#000000" },
      whatsappPhone: "010 1234 5678",
    });
    expect(p.officeColors).toEqual({ "Kafr ElDawar": "#bbf7d0" });
    expect(p.shareAll).toBe("201012345678");
    expect(whatsappNumber("+20 101 234 5678")).toBe("201012345678");
    expect(whatsappNumber("00201012345678")).toBe("201012345678");
    expect(whatsappNumber("123")).toBe("");
  });

  it("share targets: numbers and group links per office, invalid ones dropped", () => {
    const p = normalizeAlarmImagePrefs({
      shareAll: "https://chat.whatsapp.com/invite/AbCdEfGhIj1234567890",
      shareOffices: { Tanta: "01012345678", Benha: "chat.whatsapp.com/XyZ1234567890", Sadat: "hi" },
    });
    expect(p.shareAll).toBe("https://chat.whatsapp.com/AbCdEfGhIj1234567890");
    expect(p.shareOffices).toEqual({
      Tanta: "201012345678",
      Benha: "https://chat.whatsapp.com/XyZ1234567890",
    });
    expect(p.shareMode).toBe("all");
    expect(normalizeAlarmImagePrefs({ shareOffices: { Tanta: "01012345678" } }).shareMode).toBe(
      "office",
    );
    expect(
      normalizeAlarmImagePrefs({ shareMode: "office", shareAll: "01012345678" }).shareMode,
    ).toBe("office");
    expect(whatsappTarget("abc 0101234567")).toBeNull();
    expect(whatsappUrl(whatsappTarget("01012345678"), false)).toBe(
      "https://web.whatsapp.com/send?phone=201012345678",
    );
    expect(whatsappUrl(whatsappTarget("01012345678"), true)).toBe(
      "whatsapp://send?phone=201012345678",
    );
    expect(whatsappUrl(whatsappTarget(p.shareOffices.Benha!), false)).toBe(
      "https://web.whatsapp.com/accept?code=XyZ1234567890",
    );
    expect(whatsappUrl(whatsappTarget(p.shareOffices.Benha!), true)).toBe(
      "https://chat.whatsapp.com/XyZ1234567890",
    );
    expect(whatsappUrl(null, false)).toBe("https://web.whatsapp.com/");
  });

  it("time, age and count follow the shown categories, not hidden older alarms", () => {
    const rows = siteImageRows([
      alarm({
        site: "S_A_0560DE",
        siteCode: "0560DE",
        category: "OTHER",
        alarmTime: "2026-10-26T11:13:41.000Z",
      }),
      alarm({
        site: "S_A_0560DE",
        siteCode: "0560DE",
        category: "POWER",
        alarmTime: "2026-10-28T01:15:06.000Z",
      }),
      alarm({
        site: "S_A_0560DE",
        siteCode: "0560DE",
        category: "DOWN",
        alarmTime: "2026-10-27T01:00:00.000Z",
      }),
    ]);
    expect(rows[0]!.alarmTime).toBe("2026-10-26T11:13:41.000Z");
    // Power tab
    const power = shownCategories(["time", "site", "down", "power"], "POWER");
    expect(power).toEqual(["POWER"]);
    expect(withShownTime(rows, power)[0]!.alarmTime).toBe("2026-10-28T01:15:06.000Z");
    expect(shownAlarmCount(rows, power)).toBe(1);
    // All tab, Other column hidden → Down + Power
    const shown = shownCategories(["time", "site", "down", "power"], "");
    expect(shown).toEqual(["DOWN", "POWER"]);
    expect(withShownTime(rows, shown)[0]!.alarmTime).toBe("2026-10-27T01:00:00.000Z");
    expect(shownAlarmCount(rows, shown)).toBe(2);
    expect(shownCategories(["time", "site"], "")).toEqual(["DOWN", "POWER", "OTHER"]);
  });

  it("category choice: Power + Other keeps sites with either, time from those only", () => {
    const rows = siteImageRows([
      alarm({
        site: "S_A_0001DE",
        siteCode: "0001DE",
        category: "DOWN",
        alarmTime: "2026-10-26T01:00:00.000Z",
      }),
      alarm({
        site: "S_A_0001DE",
        siteCode: "0001DE",
        category: "OTHER",
        alarmTime: "2026-10-27T01:00:00.000Z",
      }),
      alarm({ site: "S_B_0002DE", siteCode: "0002DE", category: "DOWN" }),
      alarm({ site: "S_C_0003DE", siteCode: "0003DE", category: "POWER" }),
    ]);
    const cats = choiceCategories("POWER_OTHER");
    const kept = sitesWithCategories(rows, cats);
    expect(kept.map((r) => r.key).sort()).toEqual(["0001DE", "0003DE"]);
    const shown = shownCategories(["time", "site", "down", "power"], cats);
    expect(shown).toEqual(["POWER", "OTHER"]);
    expect(withShownTime(kept, shown).find((r) => r.key === "0001DE")!.alarmTime).toBe(
      "2026-10-27T01:00:00.000Z",
    );
    expect(sitesWithCategories(rows, []).length).toBe(3);
    expect(imageCategoryOf("POWER")).toBe("POWER");
    expect(imageCategoryOf("")).toBe("all");
    // split choices cover every category; their tables are listed in order
    expect(choiceCategories("all_each")).toEqual([]);
    expect(choiceCategories("all_down_env")).toEqual([]);
    expect(
      ALARM_IMAGE_CATEGORIES.find((c) => c.id === "all_down_env")!.tables.map((t) => t.label),
    ).toEqual(["Down", "Power + Other"]);
  });

  it("one table: groups by office name (no office last), the chosen sort inside", () => {
    const rows = siteImageRows([
      alarm({ site: "S_A_0001DE", siteCode: "0001DE", office: "DN/Tanta" }),
      alarm({ site: "S_B_0002DE", siteCode: "0002DE", office: null }),
      alarm({
        site: "S_C_0003DE",
        siteCode: "0003DE",
        office: "DN/Damanhour",
        alarmTime: "2026-10-26T09:00:00.000Z",
      }),
      alarm({
        site: "S_D_0004DE",
        siteCode: "0004DE",
        office: "DN/Damanhour",
        alarmTime: "2026-10-26T07:00:00.000Z",
      }),
    ]);
    const keys = (sort: "oldest" | "newest", officeFirst: boolean) =>
      sortSiteRows(rows, sort, officeFirst).map((r) => r.key);
    expect(keys("oldest", true)).toEqual(["0004DE", "0003DE", "0001DE", "0002DE"]);
    expect(keys("newest", true)).toEqual(["0003DE", "0004DE", "0001DE", "0002DE"]);
    // without office grouping the plain sort applies
    expect(keys("oldest", false)[0]).toBe("0004DE");
    expect(keys("newest", false)[0]).toBe("0003DE");
  });

  it("keeps vip and nodal; a saved Office sort falls back to oldest first", () => {
    const p = normalizeAlarmImagePrefs({ columns: ["vip", "nodal"], sort: "office" });
    expect(p.columns).toEqual(["site", "vip", "nodal"]);
    expect(p.sort).toBe("oldest");
  });
});

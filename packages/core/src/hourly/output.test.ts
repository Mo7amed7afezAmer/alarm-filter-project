import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildHourlyXlsx } from "./exportXlsx.js";
import { HOURLY_SORT_BY_SITE, sortHourlyRows } from "./filter.js";
import {
  DEFAULT_HOURLY_PREFS,
  hourlyCellFill,
  hourlyImageGroups,
  hourlySortFor,
  normalizeHourlyPrefs,
  numberSites,
  splitHourlyRows,
  visibleHourlyRows,
  type HourlyPrefs,
} from "./output.js";
import { row } from "./test-fixtures.js";
import { officeColor } from "./types.js";

const prefs = (over: Partial<HourlyPrefs> = {}): HourlyPrefs => ({
  ...DEFAULT_HOURLY_PREFS,
  ...over,
});

describe("normalizeHourlyPrefs", () => {
  it("defaults for garbage", () => {
    expect(normalizeHourlyPrefs(null)).toEqual(DEFAULT_HOURLY_PREFS);
    expect(normalizeHourlyPrefs({ tableColumns: "x", split: 3, colors: [] })).toEqual(
      DEFAULT_HOURLY_PREFS,
    );
  });

  it("keeps column order, drops unknown / duplicate keys, cleans rules", () => {
    const p = normalizeHourlyPrefs({
      tableColumns: ["siteNo", "code", "nope", "code", "alarmTime"],
      hiddenSheets: ["HW", "All"],
      hiddenCategories: ["OTHER", "PINK"],
      hiddenAlarms: [" fire alarm ", "FIRE ALARM", 4],
      sort: "code",
      colors: {
        enabled: false,
        rules: [
          { kind: "age", hours: 6, color: "#fca5a5", columns: ["alarmTime", "bad"] },
          { kind: "office", office: " tanta ", color: "bfdbfe", columns: [] },
          { kind: "age", hours: -1, color: "FFFFFF" },
          { kind: "office", office: "", color: "FFFFFF" },
          { kind: "age", hours: 2, color: "red" },
        ],
      },
      images: {
        down: { enabled: false, byOffice: true },
        power: { enabled: true, byOffice: true },
      },
      split: { mode: "downVsRest", byOffice: true },
      imageRowsPerPage: 60,
    });
    expect(p.tableColumns).toEqual(["siteNo", "code", "alarmTime"]);
    expect(p.hiddenSheets).toEqual(["HW"]);
    expect(p.hiddenCategories).toEqual(["OTHER"]);
    expect(p.hiddenAlarms).toEqual(["FIRE ALARM"]);
    expect(p.sort).toBe("code");
    expect(p.colors).toEqual({
      enabled: false,
      rules: [
        { kind: "age", hours: 6, color: "FCA5A5", columns: ["alarmTime"] },
        { kind: "office", office: "TANTA", color: "BFDBFE", columns: [] },
      ],
    });
    expect(p.images.down).toEqual({ enabled: false, byOffice: true });
    // POWER is never split per office
    expect(p.images.power).toEqual({ enabled: true, byOffice: false });
    expect(p.images.downSites).toEqual(DEFAULT_HOURLY_PREFS.images.downSites);
    expect(p.split).toEqual({ mode: "downVsRest", byOffice: true });
    expect(p.imageRowsPerPage).toBe(60);
  });

  it("an explicitly empty rule list stays empty", () => {
    expect(normalizeHourlyPrefs({ colors: { rules: [] } }).colors.rules).toEqual([]);
  });

  it("converts the older ageColors / sortBySite settings", () => {
    const p = normalizeHourlyPrefs({
      sortBySite: true,
      ageColors: {
        enabled: true,
        rules: [{ hours: 3, color: "fde68a" }],
        target: "columns",
        columns: ["alarmTime"],
      },
    });
    expect(p.sort).toBe("code");
    expect(p.colors.rules).toEqual([
      { kind: "age", hours: 3, color: "FDE68A", columns: ["alarmTime"] },
    ]);
    const row = normalizeHourlyPrefs({
      ageColors: { rules: [{ hours: 2, color: "FCA5A5" }], target: "row" },
    });
    expect(row.colors.rules).toEqual([{ kind: "age", hours: 2, color: "FCA5A5", columns: [] }]);
  });
});

describe("visibleHourlyRows", () => {
  const rows = [
    row({ alarmName: "FIRE ALARM", category: "OTHER", sheets: ["Environmental"] }),
    row({ alarmName: "BCCH MISSING", sheets: ["2G_Down", "3G_Down"] }),
    row({ alarmName: "CELL DOWN", sheets: ["2G_Down"] }),
  ];
  it("hides categories, alarm names and rows only in hidden sheets", () => {
    expect(visibleHourlyRows(rows, prefs({ hiddenCategories: ["OTHER"] }))).toHaveLength(2);
    expect(
      visibleHourlyRows(rows, prefs({ hiddenAlarms: ["CELL DOWN"] })).map((r) => r.alarmName),
    ).toEqual(["FIRE ALARM", "BCCH MISSING"]);
    // BCCH is also in 3G_Down → still shown
    expect(
      visibleHourlyRows(rows, prefs({ hiddenSheets: ["2G_Down"] })).map((r) => r.alarmName),
    ).toEqual(["FIRE ALARM", "BCCH MISSING"]);
  });
});

describe("sort by site code + numberSites", () => {
  it("groups a site's alarms and numbers the sites", () => {
    const rows = [
      row({ code: "0002DE", alarmTime: "2026-10-13 05:00:00" }),
      row({ code: "0001DE", alarmTime: "2026-10-13 04:00:00" }),
      row({ code: "0002DE", alarmTime: "2026-10-13 06:00:00" }),
      row({ code: "", alarmTime: "2026-10-13 06:00:00" }),
    ];
    expect(hourlySortFor(prefs({ sort: "code" }))).toEqual(HOURLY_SORT_BY_SITE);
    const n = numberSites(sortHourlyRows(rows, HOURLY_SORT_BY_SITE));
    // empty codes sort last
    expect(n.map((r) => [r.code, r.siteNo, r.siteAlarms])).toEqual([
      ["0001DE", 1, 1],
      ["0002DE", 2, 2],
      ["0002DE", 2, 2],
      ["", undefined, undefined],
    ]);
    expect(n.map((r) => r.alarmTime).slice(1, 3)).toEqual([
      "2026-10-13 06:00:00",
      "2026-10-13 05:00:00",
    ]);
  });
});

describe("colour rules", () => {
  const ref = "2026-10-13 12:00:00";
  const colors = (rules: HourlyPrefs["colors"]["rules"], enabled = true) =>
    prefs({ colors: { enabled, rules } });
  const age = colors([
    { kind: "age", hours: 3, color: "FDE68A", columns: [] },
    { kind: "age", hours: 6, color: "FCA5A5", columns: [] },
  ]);

  it("age: the highest period reached; never for an invalid clock, without a report time or when off", () => {
    const at = (alarmTime: string, extra = {}) =>
      hourlyCellFill(row({ alarmTime, ...extra }), "code", ref, age);
    const office = officeColor(row().office);
    expect(at("2026-10-13 10:00:00")).toBe(office);
    expect(at("2026-10-13 09:00:00")).toBe("FDE68A");
    expect(at("2026-10-12 12:00:00")).toBe("FCA5A5");
    expect(at("2019-01-01 00:00:00", { clockInvalid: true })).toBe(office);
    expect(hourlyCellFill(row({ alarmTime: "2026-10-12 12:00:00" }), "code", null, age)).toBe(
      office,
    );
    const off = prefs({ colors: { ...age.colors, enabled: false } });
    expect(hourlyCellFill(row({ alarmTime: "2026-10-12 12:00:00" }), "code", ref, off)).toBe(
      office,
    );
  });

  it("a rule paints only its columns (none = whole row)", () => {
    const p = colors([{ kind: "age", hours: 3, color: "FDE68A", columns: ["alarmTime"] }]);
    const old = row({ alarmTime: "2026-10-13 08:00:00" });
    expect(hourlyCellFill(old, "alarmTime", ref, p)).toBe("FDE68A");
    expect(hourlyCellFill(old, "code", ref, p)).toBe(officeColor(old.office));
  });

  it("office rules match the office name and win over age", () => {
    const p = colors([
      { kind: "age", hours: 1, color: "FCA5A5", columns: [] },
      { kind: "office", office: "TANTA", color: "BFDBFE", columns: ["office"] },
    ]);
    const tanta = row({ office: "Tanta", alarmTime: "2026-10-13 08:00:00" });
    expect(hourlyCellFill(tanta, "office", ref, p)).toBe("BFDBFE");
    // other columns of the same row: the age rule
    expect(hourlyCellFill(tanta, "code", ref, p)).toBe("FCA5A5");
    expect(
      hourlyCellFill(row({ office: "DUMIAT", alarmTime: "2026-10-13 08:00:00" }), "office", ref, p),
    ).toBe("FCA5A5");
  });
});

describe("splitHourlyRows", () => {
  const rows = [
    row({ office: "TANTA", category: "POWER", code: "0003DE" }),
    row({ office: "KAFR EL DAWAR", category: "DOWN", code: "0001DE" }),
    row({ office: "", category: "OTHER", code: "0009DE" }),
    row({ office: "TANTA", category: "DOWN", code: "0002DE" }),
  ];
  it("none → one numbered group", () => {
    const g = splitHourlyRows(rows, { mode: "none", byOffice: false });
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBe("");
    expect(g[0]!.rows.map((r) => r.siteNo)).toEqual([1, 2, 3, 4]);
  });
  it("DOWN vs POWER + OTHER", () => {
    const g = splitHourlyRows(rows, { mode: "downVsRest", byOffice: false });
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ["DOWN", 2],
      ["POWER + OTHER", 2],
    ]);
  });
  it("per office (unknown last) and category, empty groups dropped, numbered per group", () => {
    const g = splitHourlyRows(rows, { mode: "category", byOffice: true });
    expect(g.map((x) => x.label)).toEqual([
      "KAFR EL DAWAR · DOWN",
      "TANTA · DOWN",
      "TANTA · POWER",
      "Unknown office · OTHER",
    ]);
    expect(g.every((x) => x.rows[0]!.siteNo === 1)).toBe(true);
  });
  it("never returns zero groups", () => {
    expect(splitHourlyRows([], { mode: "category", byOffice: true })).toHaveLength(1);
  });
});

describe("hourlyImageGroups", () => {
  const rows = [
    row({ office: "TANTA", category: "DOWN", code: "0002DE", alarmName: "BCCH MISSING" }),
    row({ office: "KAFR EL DAWAR", category: "DOWN", code: "0001DE" }),
    row({ office: "TANTA", category: "DOWN", code: "0002DE", alarmName: "CELL FAULTY" }),
    row({ office: "TANTA", category: "POWER", code: "0003DE", vip: true }),
    row({ office: "KAFR EL DAWAR", category: "OTHER", code: "0004DE", nodality: "1+2" }),
    row({ office: "", category: "OTHER", code: "0009DE", nodality: "1+0" }),
  ];
  const sets = (over: Partial<HourlyPrefs["images"]>) => ({
    ...DEFAULT_HOURLY_PREFS.images,
    ...over,
  });
  const labels = (g: ReturnType<typeof hourlyImageGroups>) =>
    g.map((x) => [x.label, x.rows.length]);

  it("default: DOWN, DOWN SITES (one row per site), ENVIRONMENTAL", () => {
    const g = hourlyImageGroups(rows, DEFAULT_HOURLY_PREFS.images);
    expect(labels(g)).toEqual([
      ["DOWN", 3],
      ["DOWN SITES", 2],
      ["ENVIRONMENTAL", 3],
    ]);
    // DOWN SITES: first alarm of each code, numbered, with the alarm count of the site
    expect(g[1]!.rows.map((r) => [r.code, r.alarmName, r.siteNo, r.siteAlarms])).toEqual([
      ["0002DE", "BCCH MISSING", 1, 2],
      ["0001DE", row().alarmName, 2, 1],
    ]);
  });

  it("per office, VIP / Nodal environmental and POWER only", () => {
    const g = hourlyImageGroups(
      rows,
      sets({
        down: { enabled: true, byOffice: true },
        downSites: { enabled: false, byOffice: false },
        env: { enabled: false, byOffice: false },
        envVipNodal: { enabled: true, byOffice: false },
        power: { enabled: true, byOffice: false },
      }),
    );
    expect(labels(g)).toEqual([
      ["DOWN · KAFR EL DAWAR", 1],
      ["DOWN · TANTA", 2],
      ["ENVIRONMENTAL · VIP / NODAL", 2],
      ["POWER", 1],
    ]);
    expect(g.every((x) => x.rows[0]!.siteNo === 1)).toBe(true);
  });

  it("never returns zero groups", () => {
    const none = Object.fromEntries(
      Object.keys(DEFAULT_HOURLY_PREFS.images).map((k) => [k, { enabled: false, byOffice: false }]),
    ) as HourlyPrefs["images"];
    expect(hourlyImageGroups(rows, none)).toHaveLength(1);
    expect(hourlyImageGroups([], DEFAULT_HOURLY_PREFS.images)).toHaveLength(1);
  });
});

describe("buildHourlyXlsx with groups", () => {
  it("writes one sheet per group with the given fills", async () => {
    const groups = splitHourlyRows(
      [row({ category: "DOWN" }), row({ category: "POWER", code: "0002DE" })],
      { mode: "downVsRest", byOffice: false },
    );
    const buf = await buildHourlyXlsx(groups, ["siteNo", "code"], { fill: () => "FCA5A5" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["DOWN", "POWER + OTHER"]);
    const ws = wb.worksheets[1]!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Site #", "Site Code"]);
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(["1", "0002DE"]);
    expect((ws.getRow(2).getCell(2).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFCA5A5");
  });
});

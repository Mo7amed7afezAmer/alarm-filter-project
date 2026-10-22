import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildHourlyXlsx } from "./exportXlsx.js";
import { HOURLY_SORT_BY_SITE, sortHourlyRows } from "./filter.js";
import {
  DEFAULT_HOURLY_PREFS,
  hourlyAgeColor,
  hourlyCellFill,
  hourlySortFor,
  normalizeHourlyPrefs,
  numberSites,
  splitHourlyRows,
  visibleHourlyRows,
  type HourlyPrefs,
} from "./output.js";
import { row } from "./test-fixtures.js";
import { officeColor } from "./types.js";

const prefs = (over: Partial<HourlyPrefs> = {}): HourlyPrefs => ({ ...DEFAULT_HOURLY_PREFS, ...over });

describe("normalizeHourlyPrefs", () => {
  it("defaults for garbage", () => {
    expect(normalizeHourlyPrefs(null)).toEqual(DEFAULT_HOURLY_PREFS);
    expect(normalizeHourlyPrefs({ tableColumns: "x", split: 3, ageColors: [] })).toEqual(DEFAULT_HOURLY_PREFS);
  });

  it("keeps column order, drops unknown / duplicate keys, cleans rules", () => {
    const p = normalizeHourlyPrefs({
      tableColumns: ["siteNo", "code", "nope", "code", "alarmTime"],
      hiddenSheets: ["HW", "All"],
      hiddenCategories: ["OTHER", "PINK"],
      hiddenAlarms: [" fire alarm ", "FIRE ALARM", 4],
      ageColors: {
        enabled: false,
        rules: [
          { hours: 6, color: "#fca5a5" },
          { hours: 3, color: "fde68a" },
          { hours: -1, color: "FFFFFF" },
          { hours: 2, color: "red" },
        ],
        target: "columns",
        columns: ["alarmTime", "bad"],
      },
      split: { mode: "downVsRest", byOffice: true },
      imageRowsPerPage: 60,
    });
    expect(p.tableColumns).toEqual(["siteNo", "code", "alarmTime"]);
    expect(p.hiddenSheets).toEqual(["HW"]);
    expect(p.hiddenCategories).toEqual(["OTHER"]);
    expect(p.hiddenAlarms).toEqual(["FIRE ALARM"]);
    expect(p.ageColors).toEqual({
      enabled: false,
      rules: [
        { hours: 3, color: "FDE68A" },
        { hours: 6, color: "FCA5A5" },
      ],
      target: "columns",
      columns: ["alarmTime"],
    });
    expect(p.split).toEqual({ mode: "downVsRest", byOffice: true });
    expect(p.imageRowsPerPage).toBe(60);
  });

  it("an explicitly empty rule list stays empty", () => {
    expect(normalizeHourlyPrefs({ ageColors: { rules: [] } }).ageColors.rules).toEqual([]);
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
    expect(visibleHourlyRows(rows, prefs({ hiddenAlarms: ["CELL DOWN"] })).map((r) => r.alarmName)).toEqual([
      "FIRE ALARM",
      "BCCH MISSING",
    ]);
    // BCCH is also in 3G_Down → still shown
    expect(visibleHourlyRows(rows, prefs({ hiddenSheets: ["2G_Down"] })).map((r) => r.alarmName)).toEqual([
      "FIRE ALARM",
      "BCCH MISSING",
    ]);
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
    expect(hourlySortFor(prefs({ sortBySite: true }))).toEqual(HOURLY_SORT_BY_SITE);
    const n = numberSites(sortHourlyRows(rows, HOURLY_SORT_BY_SITE));
    // empty codes sort last
    expect(n.map((r) => [r.code, r.siteNo, r.siteAlarms])).toEqual([
      ["0001DE", 1, 1],
      ["0002DE", 2, 2],
      ["0002DE", 2, 2],
      ["", undefined, undefined],
    ]);
    expect(n.map((r) => r.alarmTime).slice(1, 3)).toEqual(["2026-10-13 06:00:00", "2026-10-13 05:00:00"]);
  });
});

describe("age colours", () => {
  const age = {
    enabled: true,
    rules: [
      { hours: 3, color: "FDE68A" },
      { hours: 6, color: "FCA5A5" },
    ],
    target: "row" as const,
    columns: ["alarmTime" as const],
  };
  const ref = "2026-10-13 12:00:00";
  it("picks the highest rule the age reaches", () => {
    expect(hourlyAgeColor(row({ alarmTime: "2026-10-13 10:00:00" }), ref, age)).toBeNull();
    expect(hourlyAgeColor(row({ alarmTime: "2026-10-13 09:00:00" }), ref, age)).toBe("FDE68A");
    expect(hourlyAgeColor(row({ alarmTime: "2026-10-12 12:00:00" }), ref, age)).toBe("FCA5A5");
    expect(hourlyAgeColor(row({ alarmTime: "2019-01-01 00:00:00", clockInvalid: true }), ref, age)).toBeNull();
    expect(hourlyAgeColor(row({ alarmTime: "2026-10-12 12:00:00" }), ref, { ...age, enabled: false })).toBeNull();
    expect(hourlyAgeColor(row({ alarmTime: "2026-10-12 12:00:00" }), null, age)).toBeNull();
  });
  it("paints the row or only the chosen columns; else the office colour", () => {
    const old = row({ alarmTime: "2026-10-13 08:00:00" });
    const p = prefs({ ageColors: age });
    expect(hourlyCellFill(old, "code", ref, p)).toBe("FDE68A");
    const cols = prefs({ ageColors: { ...age, target: "columns" } });
    expect(hourlyCellFill(old, "alarmTime", ref, cols)).toBe("FDE68A");
    expect(hourlyCellFill(old, "code", ref, cols)).toBe(officeColor(old.office));
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

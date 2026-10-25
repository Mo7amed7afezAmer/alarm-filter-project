import { describe, expect, it } from "vitest";
import { displayHides, EMPTY_DISPLAY_FILTER, normalizeDisplayFilter } from "./displayFilter.js";

describe("display filter", () => {
  it("normalizes: known categories, unique names, upper-case site exceptions", () => {
    expect(normalizeDisplayFilter(null)).toEqual(EMPTY_DISPLAY_FILTER);
    expect(
      normalizeDisplayFilter({
        hiddenCategories: ["OTHER", "PINK"],
        hiddenAlarmNames: ["BCCH MISSING", "BCCH MISSING", ""],
        exceptSites: [" 0h31de ", "0H31DE", "SRAN_S_BH-QMB-LOQIN_0H31DE", 4],
      }),
    ).toEqual({
      hiddenCategories: ["OTHER"],
      hiddenAlarmNames: ["BCCH MISSING"],
      exceptSites: ["0H31DE", "SRAN_S_BH-QMB-LOQIN_0H31DE"],
    });
  });

  it("hides the hidden types except at the exception sites (code or full site name)", () => {
    const f = normalizeDisplayFilter({
      hiddenCategories: ["OTHER"],
      hiddenAlarmNames: ["BCCH MISSING"],
      exceptSites: ["0H31DE", "S_BH-HUB_0999DE"],
    });
    const at = (alarmName: string, category: string, site: string, siteCode: string | null) =>
      displayHides(f, { alarmName, category, site, siteCode });
    expect(at("BCCH MISSING", "DOWN", "S_BH-X_0001DE", "0001DE")).toBe(true);
    expect(at("DOOR OPEN", "OTHER", "S_BH-X_0001DE", "0001DE")).toBe(true);
    expect(at("CELL FAULTY", "DOWN", "S_BH-X_0001DE", "0001DE")).toBe(false);
    // exceptions: by site code, or by full site name
    expect(at("BCCH MISSING", "DOWN", "S_BH-Y_0H31DE", "0h31de")).toBe(false);
    expect(at("DOOR OPEN", "OTHER", "s_bh-hub_0999de", null)).toBe(false);
  });
});

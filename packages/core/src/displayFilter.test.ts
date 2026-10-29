import { describe, expect, it } from "vitest";
import { displayHides, EMPTY_DISPLAY_FILTER, normalizeDisplayFilter } from "./displayFilter.js";

describe("display filter", () => {
  it("normalizes: known categories, unique names, upper-case site exceptions per name", () => {
    expect(normalizeDisplayFilter(null)).toEqual(EMPTY_DISPLAY_FILTER);
    expect(
      normalizeDisplayFilter({
        hiddenCategories: ["OTHER", "PINK"],
        hiddenAlarmNames: ["BCCH MISSING", "BCCH MISSING", ""],
        siteExceptions: {
          "BCCH MISSING": [" 0h31de ", "0H31DE", "SRAN_S_BH-QMB-LOQIN_0H31DE", 4],
          "DOOR OPEN": [],
          "": ["0001DE"],
        },
      }),
    ).toEqual({
      hiddenCategories: ["OTHER"],
      hiddenAlarmNames: ["BCCH MISSING"],
      siteExceptions: { "BCCH MISSING": ["0H31DE", "SRAN_S_BH-QMB-LOQIN_0H31DE"] },
    });
  });

  it("turns the old global exceptSites into exceptions of every hidden name", () => {
    expect(
      normalizeDisplayFilter({
        hiddenCategories: [],
        hiddenAlarmNames: ["A", "B"],
        exceptSites: ["0h31de"],
      }).siteExceptions,
    ).toEqual({ A: ["0H31DE"], B: ["0H31DE"] });
  });

  it("flips an alarm at its exception sites: hidden shows there, shown hides there", () => {
    const f = normalizeDisplayFilter({
      hiddenCategories: ["OTHER"],
      hiddenAlarmNames: ["BCCH MISSING"],
      siteExceptions: {
        "BCCH MISSING": ["0H31DE", "S_BH-HUB_0999DE"],
        "DOOR OPEN": ["0001DE"],
        "CELL FAULTY": ["0002DE"],
      },
    });
    const at = (alarmName: string, category: string, site: string, siteCode: string | null) =>
      displayHides(f, { alarmName, category, site, siteCode });
    // hidden name: hidden, except at its sites (code or full site name)
    expect(at("BCCH MISSING", "DOWN", "S_BH-X_0001DE", "0001DE")).toBe(true);
    expect(at("BCCH MISSING", "DOWN", "S_BH-Y_0H31DE", "0h31de")).toBe(false);
    expect(at("BCCH MISSING", "DOWN", "s_bh-hub_0999de", null)).toBe(false);
    // hidden by category, excepted by name
    expect(at("DOOR OPEN", "OTHER", "S_BH-Z_0003DE", "0003DE")).toBe(true);
    expect(at("DOOR OPEN", "OTHER", "S_BH-X_0001DE", "0001DE")).toBe(false);
    // shown name: shown, but hidden at its sites
    expect(at("CELL FAULTY", "DOWN", "S_BH-X_0001DE", "0001DE")).toBe(false);
    expect(at("CELL FAULTY", "DOWN", "S_BH-W_0002DE", "0002DE")).toBe(true);
    // another name at an exception site is not affected
    expect(at("LINK FAILURE", "DOWN", "S_BH-W_0002DE", "0002DE")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_UI_PREFS, normalizeUiPrefs } from "./uiPrefs.js";

describe("normalizeUiPrefs", () => {
  it("returns the defaults for null / garbage", () => {
    expect(normalizeUiPrefs(null)).toEqual(DEFAULT_UI_PREFS);
    expect(normalizeUiPrefs("x")).toEqual(DEFAULT_UI_PREFS);
    expect(normalizeUiPrefs({ theme: "pink", alarms: 5 })).toEqual(DEFAULT_UI_PREFS);
  });

  it("keeps valid values", () => {
    const p = normalizeUiPrefs({
      theme: "light",
      alarms: {
        siteInfoIcons: true,
        groupBySite: true,
        hiddenColumns: { active: ["region", "age"], cleared: ["clearType"] },
      },
    });
    expect(p).toEqual({
      theme: "light",
      alarms: {
        siteInfoIcons: true,
        groupBySite: true,
        hiddenColumns: { active: ["region", "age"], cleared: ["clearType"] },
      },
    });
  });

  it("drops unknown, required and duplicate column ids", () => {
    const p = normalizeUiPrefs({
      alarms: { hiddenColumns: { active: ["site", "nope", "age", "age", 3], cleared: "region" } },
    });
    expect(p.alarms.hiddenColumns).toEqual({ active: ["age"], cleared: [] });
  });
});

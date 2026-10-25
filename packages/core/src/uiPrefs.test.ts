import { describe, expect, it } from "vitest";
import { DEFAULT_HOURLY_PREFS } from "./hourly/output.js";
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
        view: "table",
        siteInfoIcons: true,
        groupBySite: true,
        mailGroupBySite: true,
        hiddenColumns: { active: ["region", "age"], cleared: ["clearType"] },
        mail: { phone: false, received: true, nope: true },
      },
    });
    expect(p).toEqual({
      theme: "light",
      alarms: {
        view: "table",
        siteInfoIcons: true,
        groupBySite: true,
        mailGroupBySite: true,
        hiddenColumns: { active: ["region", "age"], cleared: ["clearType"] },
        mail: { ...DEFAULT_UI_PREFS.alarms.mail, phone: false, received: true },
      },
      hourly: DEFAULT_HOURLY_PREFS,
    });
  });

  it("defaults to the mail view with age, cell / device and the call button", () => {
    const { view, mail } = DEFAULT_UI_PREFS.alarms;
    expect(view).toBe("mail");
    expect(mail).toMatchObject({ tags: true, age: true, cellDevice: true, phone: true });
  });

  it("drops unknown, required and duplicate column ids", () => {
    const p = normalizeUiPrefs({
      alarms: { hiddenColumns: { active: ["site", "nope", "age", "age", 3], cleared: "region" } },
    });
    expect(p.alarms.hiddenColumns).toEqual({ active: ["age"], cleared: [] });
  });
});

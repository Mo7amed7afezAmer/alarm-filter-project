import { describe, expect, it } from "vitest";
import { canSeePage } from "./pages";

describe("canSeePage", () => {
  it("hotline: only Alarms, Cleared, Dashboard and Settings", () => {
    for (const p of ["/alarms", "/cleared", "/dashboard", "/settings", "/settings/general"])
      expect(canSeePage("HOTLINE", p)).toBe(true);
    for (const p of ["/hourly", "/hourly/abc123", "/hourly/compare", "/site-master"])
      expect(canSeePage("HOTLINE", p)).toBe(false);
    // a page that only starts with the same letters is not hidden
    expect(canSeePage("HOTLINE", "/hourly-help")).toBe(true);
  });

  it("other roles see every page", () => {
    for (const role of ["VIEWER", "OPERATOR", "ADMIN", "SUPER_ADMIN"])
      expect(canSeePage(role, "/hourly")).toBe(true);
  });
});

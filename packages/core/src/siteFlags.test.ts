import { describe, expect, it } from "vitest";
import {
  batteryState,
  hasGenerator,
  isNodal,
  mailChips,
  otherOperatorPower,
  siteTags,
} from "./siteFlags.js";

describe("site flags", () => {
  it("every nodality except 1+0 is nodal", () => {
    expect(isNodal("1+0")).toBe(false);
    expect(isNodal(" 1 + 0 ")).toBe(false);
    expect(isNodal(null)).toBe(false);
    expect(isNodal("")).toBe(false);
    expect(isNodal("1+1")).toBe(true);
    expect(isNodal("1+85")).toBe(true);
  });

  it("generator = power source with DG, not another company's", () => {
    for (const p of [
      "DG",
      "EC+DG",
      "HGB",
      "EC+Cont DG",
      "EC+ Cont. DG",
      "Rental GEN",
      "EC+SCG GEN",
    ])
      expect(hasGenerator(p)).toBe(true);
    for (const p of ["EC", "EC/VF", "EC/ET", "ETDG", "DG/VF", "DG/ET", "DGVF/ET", "", null])
      expect(hasGenerator(p)).toBe(false);
  });

  it("other operators: VF / ET / WE, also glued to DG", () => {
    for (const p of ["EC/VF", "EC/ET", "EC/WE", "ETDG", "DG/VF", "DGVF/ET"])
      expect(otherOperatorPower(p)).toBe(true);
    for (const p of ["EC", "DG", "EC+DG", "Rental GEN", "EC+Cont DG", "HGB", null])
      expect(otherOperatorPower(p)).toBe(false);
  });
});

describe("batteryState", () => {
  it.each([
    ["YES", "ok"],
    ["New Lithium Batteries - Good - Carry site 180 mins", "ok"],
    ["Moderate", "ok"],
    ["NO", "none"],
    ["No Batteries - D9", "none"],
    ["Complete Stolen", "none"],
    ["Faulty Batteries", "weak"],
    ["Weak Batteries", "weak"],
    ["Under investigation // HGB", "unknown"],
    ["", null],
    [null, null],
  ])("%j → %j", (v, s) => expect(batteryState(v)).toBe(s));
});

describe("siteTags", () => {
  const none = { vip: null, nodality: null, battery: null, powerSource: null };

  it("only the tags the site has, in the order VIP, NODAL, BATT, GEN", () => {
    expect(siteTags(none)).toEqual([]);
    expect(siteTags({ vip: true, nodality: "1+2", battery: "YES", powerSource: "EC+DG" })).toEqual([
      "VIP",
      "NODAL",
      "BATT",
      "GEN",
    ]);
    expect(siteTags({ ...none, nodality: "1+0", battery: "No Batteries - D9" })).toEqual([]);
    expect(siteTags({ ...none, battery: "Faulty Batteries" })).toEqual([]);
  });

  it("Gmail labels add tags, but never GEN on another company's power", () => {
    expect(siteTags({ ...none, labels: ["VIP", "NDLN", "GEN"] })).toEqual(["VIP", "NODAL", "GEN"]);
    expect(siteTags({ ...none, powerSource: "DG/VF", labels: ["GEN"] })).toEqual([]);
  });
});

describe("mailChips", () => {
  const base = { office: "DN/Port Said", vip: null, nodality: null, powerSource: null };

  it("status, site tags, other labels — office labels dropped", () => {
    const chips = mailChips({
      ...base,
      cleared: true,
      labels: ["INBOX", "VIP", "CLR", "Out of Area", "DN/Port Said", "DS/Benha", "NDLN", "GEN"],
    });
    expect(chips.map((c) => c.label)).toEqual(["CLR", "VIP", "NODAL", "GEN", "Out of Area"]);
  });

  it("adds tags from Site Master when the mail has no such label", () => {
    const chips = mailChips({
      ...base,
      cleared: false,
      labels: [],
      vip: true,
      nodality: "1+2",
      battery: "YES",
      powerSource: "EC+DG",
    });
    expect(chips.map((c) => c.label)).toEqual(["ALM", "VIP", "NODAL", "BATT", "GEN"]);
    expect(
      mailChips({ ...base, cleared: false, labels: [], nodality: "1+0", powerSource: "EC" }).map(
        (c) => c.label,
      ),
    ).toEqual(["ALM"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canManage,
  checkAssignment,
  hasRole,
  isOfficeGroup,
  officeGroups,
  officeInScope,
  scopeOfficeOf,
  type Account,
} from "./roles.js";

const KD = "DN/Kafr ElDawar";
const TANTA = "DN/Tanta";
const superAdmin: Account = { id: 1, role: "SUPER_ADMIN", office: null };
const kdAdmin: Account = { id: 2, role: "ADMIN", office: KD };
const kdViewer: Account = { id: 3, role: "VIEWER", office: KD };
const tantaViewer: Account = { id: 4, role: "VIEWER", office: TANTA };
const kdAdmin2: Account = { id: 5, role: "ADMIN", office: KD };

describe("roles", () => {
  it("ranks super admin above office admin above operator above viewer", () => {
    expect(hasRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(hasRole("ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(hasRole("ADMIN", "OPERATOR")).toBe(true);
    expect(hasRole("VIEWER", "OPERATOR")).toBe(false);
    expect(hasRole(undefined, "VIEWER")).toBe(false);
  });

  it("scopes data: own office for office users, chosen office or all for the super admin", () => {
    expect(scopeOfficeOf(kdViewer)).toBe(KD);
    expect(scopeOfficeOf(kdAdmin)).toBe(KD);
    expect(scopeOfficeOf({ role: "VIEWER", office: null })).toBe(""); // sees nothing
    expect(scopeOfficeOf(superAdmin)).toBeNull(); // all offices
    expect(scopeOfficeOf({ role: "SUPER_ADMIN", office: TANTA })).toBe(TANTA);
  });

  it("the super admin can view a whole office group (DN / DS)", () => {
    expect(scopeOfficeOf({ role: "SUPER_ADMIN", office: "DN" })).toBe("DN");
    expect(isOfficeGroup("DN")).toBe(true);
    expect(isOfficeGroup(TANTA)).toBe(false);
    expect(isOfficeGroup(null)).toBe(false);
    expect(isOfficeGroup("")).toBe(false);
    expect(officeInScope(TANTA, "DN")).toBe(true);
    expect(officeInScope("DS/Benha", "DN")).toBe(false);
    expect(officeInScope("DNX/Other", "DN")).toBe(false);
    expect(officeInScope(TANTA, TANTA)).toBe(true);
    expect(officeInScope(KD, TANTA)).toBe(false);
    expect(officeInScope(null, "DN")).toBe(false);
    expect(officeInScope(null, null)).toBe(true);
    expect(officeInScope(KD, "")).toBe(false);
    expect(officeGroups([KD, "DS/Benha", TANTA, "Loose"])).toEqual(["DN", "DS"]);
  });

  it("office admin manages only viewers/operators of their own office", () => {
    expect(canManage(kdAdmin, kdViewer)).toBe(true);
    expect(canManage(kdAdmin, { ...kdViewer, role: "OPERATOR" })).toBe(true);
    expect(canManage(kdAdmin, tantaViewer)).toBe(false);
    expect(canManage(kdAdmin, kdAdmin2)).toBe(false);
    expect(canManage(kdAdmin, superAdmin)).toBe(false);
    expect(canManage(kdAdmin, kdAdmin)).toBe(false);
    expect(canManage(kdViewer, kdViewer)).toBe(false);
  });

  it("super admin manages everyone but themselves", () => {
    expect(canManage(superAdmin, tantaViewer)).toBe(true);
    expect(canManage(superAdmin, kdAdmin)).toBe(true);
    expect(canManage(superAdmin, { id: 9, role: "SUPER_ADMIN", office: null })).toBe(true);
    expect(canManage(superAdmin, superAdmin)).toBe(false);
  });

  it("checks role + office on create/update", () => {
    expect(assignableRoles(kdAdmin)).toEqual(["VIEWER", "OPERATOR"]);
    expect(assignableRoles(kdViewer)).toEqual([]);
    expect(checkAssignment(kdAdmin, "VIEWER", undefined)).toEqual({ office: KD });
    expect(checkAssignment(kdAdmin, "VIEWER", TANTA)).toHaveProperty("error");
    expect(checkAssignment(kdAdmin, "ADMIN", KD)).toHaveProperty("error");
    expect(checkAssignment(superAdmin, "ADMIN", TANTA)).toEqual({ office: TANTA });
    expect(checkAssignment(superAdmin, "VIEWER", null)).toHaveProperty("error");
    expect(checkAssignment(superAdmin, "SUPER_ADMIN", null)).toEqual({ office: null });
  });
});

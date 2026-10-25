// Roles and office access — pure functions (unit-tested in roles.test.ts).
//   VIEWER < OPERATOR < ADMIN (office admin) < SUPER_ADMIN.
// Everyone but SUPER_ADMIN belongs to one office (users.office) and sees only that office.
// An office admin manages the viewers/operators of their own office; the super admin manages
// everyone and every setting, and picks which office (or all) they are looking at.

export const ROLES = ["VIEWER", "OPERATOR", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Role hierarchy: each role can do everything the ones before it can. */
export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };

export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "viewer",
  OPERATOR: "operator",
  ADMIN: "office admin",
  SUPER_ADMIN: "super admin",
};

export const hasRole = (actual: string | undefined, needed: Role): boolean =>
  actual !== undefined && (ROLE_RANK[actual as Role] ?? -1) >= ROLE_RANK[needed];

export const isSuperAdmin = (role: string | undefined): boolean => role === "SUPER_ADMIN";

export interface Account {
  id: number;
  role: Role;
  office: string | null;
}

/**
 * Office whose data this user sees: null = every office (super admin with no office picked);
 * "" = none (a user without an office — matches no row, office is never stored as "").
 */
export function scopeOfficeOf(user: Pick<Account, "role" | "office">): string | null {
  if (isSuperAdmin(user.role)) return user.office || null;
  return user.office || "";
}

/**
 * The super admin can also view a whole office group: the parent label ("DN") of the office
 * labels "DN/…" (2026-10-25). Office labels always have a parent, so a scope without "/" is a
 * group. Office users always have one office label.
 */
export const isOfficeGroup = (scope: string | null | undefined): scope is string =>
  !!scope && !scope.includes("/");

/** Is an office label (alarm / mail office) inside the scope? null scope = every office. */
export function officeInScope(office: string | null | undefined, scope: string | null): boolean {
  if (scope === null) return true;
  if (!office) return false;
  return office === scope || (isOfficeGroup(scope) && office.startsWith(`${scope}/`));
}

/** Office groups ("DN", "DS") of a list of office labels, in first-seen order. */
export const officeGroups = (labels: readonly string[]): string[] => [
  ...new Set(labels.filter((l) => l.includes("/")).map((l) => l.slice(0, l.lastIndexOf("/")))),
];

/** Roles this actor may give to accounts they create or edit. */
export function assignableRoles(actor: Pick<Account, "role">): Role[] {
  if (isSuperAdmin(actor.role)) return [...ROLES];
  if (actor.role === "ADMIN") return ["VIEWER", "OPERATOR"];
  return [];
}

/** May `actor` see / edit / delete `target`? Never themselves through user management. */
export function canManage(actor: Account, target: Account): boolean {
  if (actor.id === target.id) return false;
  if (isSuperAdmin(actor.role)) return true;
  return (
    actor.role === "ADMIN" &&
    !!actor.office &&
    target.office === actor.office &&
    assignableRoles(actor).includes(target.role)
  );
}

/**
 * Checks a create/update of an account with `role` + `office` by `actor`.
 * Returns the office to store, or an error message.
 */
export function checkAssignment(
  actor: Account,
  role: Role,
  office: string | null | undefined,
): { office: string | null } | { error: string } {
  if (!assignableRoles(actor).includes(role))
    return { error: `You cannot give the ${ROLE_LABEL[role]} role` };
  if (!isSuperAdmin(actor.role)) {
    if (!actor.office) return { error: "Your account has no office" };
    if (office && office !== actor.office)
      return { error: "You can only manage users of your own office" };
    return { office: actor.office };
  }
  if (role === "SUPER_ADMIN") return { office: office || null };
  if (!office) return { error: `A ${ROLE_LABEL[role]} needs an office` };
  return { office };
}

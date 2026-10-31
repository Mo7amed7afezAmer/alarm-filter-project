// Office scope of the signed-in user — every page and stat is filtered to it (@alarm/core roles.ts):
// office users see their own office; the super admin sees the office they picked, a whole office
// group ("DN" = every "DN/…" label), or all. Alarms carry their resolved office (Site Master
// first, then the mail label — @alarm/db resolveOffices), so the scope is an `office` filter.
import { isOfficeGroup, officeMatchKey, scopeOfficeOf } from "@alarm/core";
import { prisma } from "@alarm/db";

/** null = all offices; "" = none (user without an office); else the office label or group. */
export async function getOffice(userId: number | undefined): Promise<string | null> {
  const u = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, office: true } })
    : null;
  return u ? scopeOfficeOf(u) : "";
}

export type OfficeWhere = { office?: string | { startsWith: string } };

/** Prisma filter (alarms, orphan clears, raw messages) for an office scope. */
export function officeWhere(scope: string | null): OfficeWhere {
  if (scope === null) return {};
  return isOfficeGroup(scope) ? { office: { startsWith: `${scope}/` } } : { office: scope };
}

/** Prisma filter (alarms, orphan clears, raw messages) for the user's office scope. */
export async function officeFilter(userId: number | undefined): Promise<OfficeWhere> {
  return officeWhere(await getOffice(userId));
}

/** Office labels to choose from (the worker refreshes them from Gmail every 10 min). */
export async function availableOffices(): Promise<string[]> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { availableLabels: true },
  });
  const list = Array.isArray(s?.availableLabels) ? (s.availableLabels as { name?: unknown }[]) : [];
  return list.map((l) => l?.name).filter((n): n is string => typeof n === "string");
}

/**
 * Test for Site Master / hourly-report office names ("KAFR EL DAWAR") in a scope: every name
 * (null), none (""), one office label, or every label of an office group.
 */
export async function siteOfficeMatcher(
  scope: string | null,
): Promise<(name: string | null | undefined) => boolean> {
  if (scope === null) return () => true;
  if (!scope) return () => false;
  if (!isOfficeGroup(scope)) return (name) => sameOffice(name, scope);
  const keys = new Set(
    (await availableOffices())
      .filter((l) => l.startsWith(`${scope}/`))
      .map(officeMatchKey)
      .filter(Boolean),
  );
  return (name) => !!name && keys.has(officeMatchKey(name));
}

/** Does a Site Master / hourly-report office name ("KAFR EL DAWAR") belong to `office`? */
export function sameOffice(siteMasterOffice: string | null | undefined, office: string): boolean {
  const k = officeMatchKey(office);
  return !!k && !!siteMasterOffice && officeMatchKey(siteMasterOffice) === k;
}

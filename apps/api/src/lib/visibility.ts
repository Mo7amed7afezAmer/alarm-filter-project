// Alarm types hidden from display (admin setting). Combined with the office scope, this is the
// single filter every page, stat, export and notification uses — hidden alarms stay stored.
import { type DisplayFilter } from "@alarm/core";
import {
  getDisplayFilter as readDisplayFilter,
  getUserDisplayFilter as readUserDisplayFilter,
  prisma,
  type Prisma,
} from "@alarm/db";
import { isOfficeGroup } from "@alarm/core";
import { getOffice, officeWhere } from "./office.js";

export { hiddenCount, normalizeDisplayFilter, type DisplayFilter } from "@alarm/core";

export const getDisplayFilter = (): Promise<DisplayFilter> => readDisplayFilter(prisma);

/** Types the given user hides from their own pages (empty when none / no user). */
export const getUserDisplayFilter = (userId?: number): Promise<DisplayFilter> =>
  readUserDisplayFilter(prisma, userId);

/** Admin (everyone) and personal (this user) hidden types — kept apart, each with its own site
 *  exceptions. */
export async function displayFilters(userId?: number): Promise<DisplayFilter[]> {
  return Promise.all([getDisplayFilter(), getUserDisplayFilter(userId)]);
}

/** Prisma condition for one filter: the alarm's type is not hidden, or its site is an exception
 *  (site code or full site name). Null when the filter hides nothing. */
function visibleWhere(f: DisplayFilter): Prisma.AlarmWhereInput | null {
  const hidden: Prisma.AlarmWhereInput[] = [];
  if (f.hiddenCategories.length) hidden.push({ category: { in: f.hiddenCategories } });
  if (f.hiddenAlarmNames.length) hidden.push({ alarmName: { in: f.hiddenAlarmNames } });
  if (!hidden.length) return null;
  const shown: Prisma.AlarmWhereInput[] = [{ NOT: { OR: hidden } }];
  if (f.exceptSites.length)
    shown.push({ siteCode: { in: f.exceptSites } }, { site: { in: f.exceptSites } });
  return { OR: shown };
}

/** Prisma condition: the user's office scope AND not hidden (by the admin or by this user, each
 *  with its own site exceptions). Combine with other conditions via AND. */
export async function alarmScope(userId?: number): Promise<Prisma.AlarmWhereInput> {
  const [office, filters] = await Promise.all([getOffice(userId), displayFilters(userId)]);
  const and: Prisma.AlarmWhereInput[] = [];
  if (office !== null) and.push(officeWhere(office)); // "" (no office) matches nothing
  for (const f of filters) {
    const w = visibleWhere(f);
    if (w) and.push(w);
  }
  return { AND: and };
}

/** Same scope as raw-SQL values for $queryRaw (alarms table):
 *  `allOffices OR office = officeExact OR office LIKE officePrefix` (nulls never match), and per
 *  filter (admin, mine): `NOT (category = ANY(cats) OR alarmName = ANY(names))
 *  OR siteCode = ANY(sites) OR upper(site) = ANY(sites)`. */
export async function alarmScopeSql(userId?: number) {
  const [office, [admin, mine]] = await Promise.all([getOffice(userId), displayFilters(userId)]);
  const group = isOfficeGroup(office);
  return {
    allOffices: office === null,
    officeExact: office !== null && !group ? office : null,
    officePrefix: group ? `${office}/%` : null,
    admin: admin!,
    mine: mine!,
  };
}

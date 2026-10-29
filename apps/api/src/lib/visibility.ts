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

/** The alarm's site is one of these (site code or full site name). */
const siteIn = (sites: string[]): Prisma.AlarmWhereInput => ({
  OR: [{ siteCode: { in: sites } }, { site: { in: sites } }],
});
/** NOT siteIn, written out so a null siteCode counts as "not in" (SQL NOT IN drops nulls). */
const siteNotIn = (sites: string[]): Prisma.AlarmWhereInput => ({
  AND: [{ OR: [{ siteCode: null }, { siteCode: { notIn: sites } }] }, { site: { notIn: sites } }],
});

/** Prisma condition for one filter (displayHides): visible = type not hidden, flipped at the
 *  exception sites of the alarm's name. Null when the filter hides nothing. */
function visibleWhere(f: DisplayFilter): Prisma.AlarmWhereInput | null {
  const cats = f.hiddenCategories;
  const typeHidden: Prisma.AlarmWhereInput[] = [];
  if (cats.length) typeHidden.push({ category: { in: cats } });
  if (f.hiddenAlarmNames.length) typeHidden.push({ alarmName: { in: f.hiddenAlarmNames } });
  const excepted = Object.keys(f.siteExceptions);
  const and: Prisma.AlarmWhereInput[] = [];
  // names without exceptions: their type is not hidden
  if (typeHidden.length)
    and.push({ OR: [{ alarmName: { in: excepted } }, { NOT: { OR: typeHidden } }] });
  // names with exceptions: shown name → not at its sites; hidden name → only at its sites
  for (const name of excepted) {
    const sites = f.siteExceptions[name]!;
    const visible: Prisma.AlarmWhereInput = f.hiddenAlarmNames.includes(name)
      ? siteIn(sites)
      : cats.length
        ? {
            OR: [
              { AND: [{ category: { notIn: cats } }, siteNotIn(sites)] },
              { AND: [{ category: { in: cats } }, siteIn(sites)] },
            ],
          }
        : siteNotIn(sites);
    and.push({ OR: [{ alarmName: { not: name } }, visible] });
  }
  return and.length ? { AND: and } : null;
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
 *  filter (admin, mine): `(category = ANY(cats) OR alarmName = ANY(names)) = (the site is in
 *  exceptions -> alarmName)` — `exceptions` is the filter's siteExceptions as JSON. */
export async function alarmScopeSql(userId?: number) {
  const [office, [admin, mine]] = await Promise.all([getOffice(userId), displayFilters(userId)]);
  const group = isOfficeGroup(office);
  return {
    allOffices: office === null,
    officeExact: office !== null && !group ? office : null,
    officePrefix: group ? `${office}/%` : null,
    admin: { ...admin!, exceptions: JSON.stringify(admin!.siteExceptions) },
    mine: { ...mine!, exceptions: JSON.stringify(mine!.siteExceptions) },
  };
}

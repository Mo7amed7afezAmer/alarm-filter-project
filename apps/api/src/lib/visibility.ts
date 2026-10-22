// Alarm types hidden from display (admin setting). Combined with the office scope, this is the
// single filter every page, stat, export and notification uses — hidden alarms stay stored.
import { type DisplayFilter } from "@alarm/core";
import {
  getDisplayFilter as readDisplayFilter,
  getUserDisplayFilter as readUserDisplayFilter,
  prisma,
  type Prisma,
} from "@alarm/db";
import { getOffice } from "./office.js";

export { hiddenCount, normalizeDisplayFilter, type DisplayFilter } from "@alarm/core";

export const getDisplayFilter = (): Promise<DisplayFilter> => readDisplayFilter(prisma);

/** Types the given user hides from their own pages (empty when none / no user). */
export const getUserDisplayFilter = (userId?: number): Promise<DisplayFilter> =>
  readUserDisplayFilter(prisma, userId);

/** Admin (everyone) + personal (this user) hidden types, merged. */
export async function effectiveDisplayFilter(userId?: number): Promise<DisplayFilter> {
  const [admin, mine] = await Promise.all([getDisplayFilter(), getUserDisplayFilter(userId)]);
  return {
    hiddenCategories: [...new Set([...admin.hiddenCategories, ...mine.hiddenCategories])],
    hiddenAlarmNames: [...new Set([...admin.hiddenAlarmNames, ...mine.hiddenAlarmNames])],
  };
}

/** Prisma condition: the user's office scope AND not hidden (by the admin or by this user).
 *  Combine with other conditions via AND. */
export async function alarmScope(userId?: number): Promise<Prisma.AlarmWhereInput> {
  const [office, f] = await Promise.all([getOffice(userId), effectiveDisplayFilter(userId)]);
  const and: Prisma.AlarmWhereInput[] = [];
  if (office !== null) and.push({ office }); // "" (no office) matches nothing
  if (f.hiddenCategories.length) and.push({ category: { notIn: f.hiddenCategories } });
  if (f.hiddenAlarmNames.length) and.push({ alarmName: { notIn: f.hiddenAlarmNames } });
  return { AND: and };
}

/** Same scope as raw-SQL fragments for $queryRaw (alarms table). office null = all offices. */
export async function alarmScopeSql(userId?: number) {
  const [office, f] = await Promise.all([getOffice(userId), effectiveDisplayFilter(userId)]);
  return { office, hiddenCategories: f.hiddenCategories, hiddenAlarmNames: f.hiddenAlarmNames };
}

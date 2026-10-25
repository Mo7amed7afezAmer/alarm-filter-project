// Hidden alarm types as stored: admin (system_status.displayFilter) and personal
// (users.displayPrefs). Used by the API (every list/stat) and the web layout (header note).
import { EMPTY_DISPLAY_FILTER, normalizeDisplayFilter, type DisplayFilter } from "@alarm/core";
import type { PrismaClient } from "@prisma/client";

export async function getDisplayFilter(prisma: PrismaClient): Promise<DisplayFilter> {
  const s = await prisma.systemStatus.findUnique({
    where: { id: 1 },
    select: { displayFilter: true },
  });
  return normalizeDisplayFilter(s?.displayFilter);
}

/** Types the given user hides from their own pages (empty when none / no user). */
export async function getUserDisplayFilter(
  prisma: PrismaClient,
  userId?: number,
): Promise<DisplayFilter> {
  if (!userId) return { ...EMPTY_DISPLAY_FILTER };
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayPrefs: true } });
  return normalizeDisplayFilter(u?.displayPrefs);
}

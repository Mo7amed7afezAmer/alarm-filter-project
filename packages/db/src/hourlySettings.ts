// Hourly report settings shared per office (table hourly_settings): the office's own row, else
// the "*" default, else the built-in defaults. Used by the API (rows, Excel, settings) and the
// web layout (the hourly pages render with them at once).
import { normalizeHourlyPrefs, type HourlyPrefs } from "@alarm/core";
import type { PrismaClient } from "@prisma/client";

/** Key of the default settings (offices without their own). */
export const HOURLY_DEFAULT_KEY = "*";

export interface ResolvedHourlySettings {
  prefs: HourlyPrefs;
  /** Row the settings came from: an office label, "*", or null (built-in defaults). */
  source: string | null;
}

/** Key of an office's own settings: a single office label ("DN/Tanta"); null for all offices,
 *  an office group ("DN") or no office. */
export const hourlyOfficeKey = (scope: string | null | undefined): string | null =>
  scope && scope.includes("/") ? scope : null;

/** Settings for an office scope (getOffice / scopeOfficeOf): its own row, else the default. */
export async function getHourlySettings(
  prisma: PrismaClient,
  scope: string | null | undefined,
): Promise<ResolvedHourlySettings> {
  const own = hourlyOfficeKey(scope);
  const rows = await prisma.hourlySettings.findMany({
    where: { key: { in: own ? [own, HOURLY_DEFAULT_KEY] : [HOURLY_DEFAULT_KEY] } },
  });
  const row = rows.find((r) => r.key === own) ?? rows.find((r) => r.key === HOURLY_DEFAULT_KEY);
  return { prefs: normalizeHourlyPrefs(row?.prefs), source: row?.key ?? null };
}

/**
 * The settings row a user edits: an office admin their office; the super admin the office they
 * are viewing (`scope`), or the "*" default for all offices / an office group. Others: none.
 */
export function hourlyEditKey(
  user: { role: string; office: string | null },
  scope: string | null | undefined,
): string | null {
  if (user.role === "SUPER_ADMIN") return hourlyOfficeKey(scope) ?? HOURLY_DEFAULT_KEY;
  if (user.role === "ADMIN") return hourlyOfficeKey(user.office);
  return null;
}

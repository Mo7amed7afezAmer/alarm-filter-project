// Main pages a role may not open (sidebar + a redirect on the page itself). User request
// 2026-10-29: a hotline account sees only Alarms, Cleared, Dashboard and Settings.

const HIDDEN: Partial<Record<string, readonly string[]>> = {
  HOTLINE: ["/hourly", "/site-master"],
};

/** May `role` open the page at `path` (or any page under it)? */
export function canSeePage(role: string, path: string): boolean {
  return !(HIDDEN[role] ?? []).some((p) => path === p || path.startsWith(`${p}/`));
}

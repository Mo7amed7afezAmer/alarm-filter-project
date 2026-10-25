// Hourly reports service (§14, stateless): Gmail attachment → @alarm/core/hourly pipeline →
// in-process cache. The hourly controllers call these; nothing about alarm rows is persisted.

import {
  CATEGORIES,
  HOURLY_COLUMN_KEYS,
  HOURLY_DEFAULT_COLUMNS,
  type Category,
  type HourlyColumnKey,
  type HourlyFilters,
  type HourlyMeta,
  hasRole,
  type HourlyRow,
  type Role,
} from "@alarm/core";
import {
  HourlyReportError,
  limitsFromEnv,
  processReport,
  type ProcessedReport,
} from "@alarm/core/hourly";
import { HttpError } from "../common/http.js";
import { prisma } from "@alarm/db";
import { hourlySource, NotFoundError } from "./gmail.js";
import { getOffice, siteOfficeMatcher } from "./office.js";
import { ReportCache, type CacheStatus } from "./hourlyCache.js";

const ttlMin = Number(process.env.HOURLY_CACHE_MIN) > 0 ? Number(process.env.HOURLY_CACHE_MIN) : 30;

const g = globalThis as unknown as { hourlyCache?: ReportCache<ProcessedReport> };
/** One cache per API process (see lib/hourlyCache.ts). */
export const hourlyCache = (g.hourlyCache ??= new ReportCache<ProcessedReport>(
  ttlMin * 60_000,
  20,
));

export type ReportStatus = CacheStatus<HourlyMeta>;

/**
 * Saves the report's alarm names for the hide lists (hourly_alarm_names): section DOWN / ENV,
 * category, row count and the Alarm Text values seen with the name (kept as a union, so the
 * settings search finds an alarm by its Alarm Text too). The rest keeps the data of the newest
 * report the name was seen in.
 */
export async function recordAlarmNames(rows: readonly HourlyRow[], seenAt: Date): Promise<void> {
  const byName = new Map<
    string,
    { section: string; category: string; count: number; texts: Set<string> }
  >();
  for (const r of rows) {
    const name = r.alarmName.trim();
    if (!name) continue;
    let e = byName.get(name);
    if (!e) {
      e = {
        section: r.category === "DOWN" ? "DOWN" : "ENV",
        category: r.category,
        count: 0,
        texts: new Set(),
      };
      byName.set(name, e);
    }
    e.count++;
    const text = r.alarmText.trim();
    if (text && text !== name) e.texts.add(text);
  }
  if (!byName.size) return;
  const names = [...byName.keys()];
  const list = [...byName.values()];
  // texts of one name joined by U+001F (never in report text), split again in SQL
  const texts = list.map((x) => [...x.texts].join("\u001f"));
  await prisma.$executeRaw`
    INSERT INTO "hourly_alarm_names" ("name", "section", "category", "lastCount", "lastSeen", "alarmTexts")
    SELECT n, s, c, k, ${seenAt}, CASE WHEN x = '' THEN ARRAY[]::text[] ELSE string_to_array(x, chr(31)) END
    FROM unnest(${names}::text[], ${list.map((x) => x.section)}::text[],
                ${list.map((x) => x.category)}::text[], ${list.map((x) => x.count)}::int[],
                ${texts}::text[]) AS t(n, s, c, k, x)
    ON CONFLICT ("name") DO UPDATE SET
      "section"    = CASE WHEN EXCLUDED."lastSeen" >= "hourly_alarm_names"."lastSeen" THEN EXCLUDED."section" ELSE "hourly_alarm_names"."section" END,
      "category"   = CASE WHEN EXCLUDED."lastSeen" >= "hourly_alarm_names"."lastSeen" THEN EXCLUDED."category" ELSE "hourly_alarm_names"."category" END,
      "lastCount"  = CASE WHEN EXCLUDED."lastSeen" >= "hourly_alarm_names"."lastSeen" THEN EXCLUDED."lastCount" ELSE "hourly_alarm_names"."lastCount" END,
      "lastSeen"   = GREATEST(EXCLUDED."lastSeen", "hourly_alarm_names"."lastSeen"),
      "alarmTexts" = ARRAY(SELECT DISTINCT unnest("hourly_alarm_names"."alarmTexts" || EXCLUDED."alarmTexts") ORDER BY 1)`;
}

/** Download → validate → extract → parse → enrich/normalize. Temp files never outlive this.
 *  `record` saves the alarm names (seen now); the collect job saves them with the mail time. */
async function processNow(gmailId: string, record = true): Promise<ProcessedReport> {
  let attachment: { fileName: string; data: Buffer };
  try {
    attachment = await hourlySource().getAttachment(gmailId);
  } catch (err) {
    if (err instanceof NotFoundError) throw new HttpError(404, err.message);
    throw err;
  }
  const [sites, normalizations] = await Promise.all([
    prisma.siteMaster.findMany(),
    prisma.hourlyNormalization.findMany(),
  ]);
  const report = await processReport({
    fileName: attachment.fileName,
    data: attachment.data,
    sites,
    normalizations,
    limits: limitsFromEnv(),
  });
  if (record)
    await recordAlarmNames(report.rows, new Date()).catch((err) =>
      console.error(`hourly ${gmailId}: alarm names not saved:`, err),
    );
  return report;
}

/** Reports the collect job reads: the newest ones (about a day of hourly mail). */
export const COLLECT_REPORTS = 24;

export interface CollectState {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  finishedAt: string | null;
}

const collect = ((globalThis as unknown as { hourlyCollect?: CollectState }).hourlyCollect ??= {
  running: false,
  done: 0,
  total: 0,
  failed: 0,
  finishedAt: null,
});

export const collectState = (): CollectState => ({ ...collect });

/**
 * Background job: reads the newest COLLECT_REPORTS reports (cached ones are not downloaded
 * again) and saves their alarm names with the mail time. Mails without a usable attachment
 * count as failed. Runs once at a time; does not touch the report cache.
 */
export function startCollect(): CollectState {
  if (collect.running) return collectState();
  Object.assign(collect, { running: true, done: 0, total: 0, failed: 0, finishedAt: null });
  (async () => {
    const reports = [];
    for (let page = 1; reports.length < COLLECT_REPORTS; page++) {
      const r = await hourlySource().list({ page, pageSize: 25 });
      reports.push(...r.reports);
      if (!r.hasMore) break;
    }
    const list = reports.slice(0, COLLECT_REPORTS);
    collect.total = list.length;
    for (const r of list) {
      try {
        const report = hourlyCache.get(r.gmailId) ?? (await processNow(r.gmailId, false));
        await recordAlarmNames(report.rows, new Date(r.receivedAt));
      } catch {
        collect.failed++;
      }
      collect.done++;
    }
  })()
    .catch((err) => console.error("hourly collect:", err))
    .finally(() =>
      Object.assign(collect, { running: false, finishedAt: new Date().toISOString() }),
    );
  return collectState();
}

/** Starts processing in the background (202 flow). Errors land in the status. */
export function startProcessing(gmailId: string, force = false): ReportStatus {
  hourlyCache
    .run(gmailId, () => processNow(gmailId), force)
    .catch((err) => {
      if (!(err instanceof HourlyReportError) && !(err instanceof HttpError))
        console.error(`hourly ${gmailId}:`, err);
    });
  return hourlyCache.status(gmailId);
}

/**
 * Processed report for reading (rows / export / diff). Served from cache; a cold report
 * that was processed before is re-processed transparently. A report nobody processed yet
 * needs an operator (viewers get 409 and see the Process button state instead).
 */
export async function getReport(
  gmailId: string,
  role: string | undefined,
): Promise<ProcessedReport> {
  const cached = hourlyCache.get(gmailId);
  if (cached) return cached;
  if (!hourlyCache.wasProcessed(gmailId) && !hasRole(role, "OPERATOR" satisfies Role))
    throw new HttpError(
      409,
      "This report has not been processed yet — ask an operator to process it",
    );
  try {
    return await hourlyCache.run(gmailId, () => processNow(gmailId));
  } catch (err) {
    if (err instanceof HourlyReportError) throw new HttpError(422, err.message, { code: err.code });
    throw err;
  }
}

/**
 * Rows the user may see: the super admin (all offices) gets every row; an office user only the
 * rows whose Site Master office is their office (rows with an unknown site code are left out).
 */
export async function scopeRows(rows: HourlyRow[], userId: number): Promise<HourlyRow[]> {
  const office = await getOffice(userId);
  if (office === null) return rows;
  const inScope = await siteOfficeMatcher(office);
  return rows.filter((r) => inScope(r.office));
}

// ---- query parsing (filters are repeatable: ?office=A&office=B) ----

const GMAIL_ID = /^[A-Za-z0-9_-]{6,64}$/;

export function checkGmailId(id: string): string {
  if (!GMAIL_ID.test(id)) throw new HttpError(400, "Invalid report id");
  return id;
}

const many = (sp: URLSearchParams, key: string): string[] | undefined => {
  const v = sp
    .getAll(key)
    .map((s) => s.trim())
    .filter(Boolean);
  return v.length ? v : undefined;
};

const WALL = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

/** Filters from the URL — the same keys the /hourly page keeps in its own URL. */
export function parseFilters(sp: URLSearchParams): HourlyFilters {
  const category = many(sp, "category");
  if (category?.some((c) => !(CATEGORIES as readonly string[]).includes(c)))
    throw new HttpError(400, "Invalid query", { category: ["must be DOWN, POWER or OTHER"] });
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  for (const [k, v] of [
    ["from", from],
    ["to", to],
  ] as const)
    if (v && !WALL.test(v))
      throw new HttpError(400, "Invalid query", { [k]: ["use YYYY-MM-DD HH:mm"] });
  const vip = sp.get("vip");
  if (vip && vip !== "true" && vip !== "false")
    throw new HttpError(400, "Invalid query", { vip: ["true or false"] });
  const q = sp.get("q")?.trim();
  if (q && q.length > 100) throw new HttpError(400, "Invalid query", { q: ["too long"] });
  return {
    sheet: sp.get("sheet") || undefined,
    region: many(sp, "region"),
    office: many(sp, "office"),
    alarm: many(sp, "alarm"),
    siteType: many(sp, "siteType"),
    category: category as Category[] | undefined,
    vip: vip ? vip === "true" : undefined,
    from,
    to,
    q: q || undefined,
  };
}

/** ?columns=a,b,c (or repeated) → known keys in the given order; default = §14 columns. */
export function parseColumns(sp: URLSearchParams): HourlyColumnKey[] {
  const raw = sp
    .getAll("columns")
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!raw.length) return HOURLY_DEFAULT_COLUMNS;
  const bad = raw.filter((c) => !(HOURLY_COLUMN_KEYS as string[]).includes(c));
  if (bad.length)
    throw new HttpError(400, "Invalid query", { columns: [`unknown: ${bad.join(", ")}`] });
  return [...new Set(raw)] as HourlyColumnKey[];
}

export type { HourlyRow };

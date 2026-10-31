/53+# Alarm Filter — Mobile Network Alarm Email Processor (Local / Docker)

## 1. Purpose
A web system that reads mobile-network alarm emails from Gmail, classifies them
(Down / Power / Other), matches each alarm with its later "Clear" email, and shows:
- **Alarm page**: alarms still active (no Clear received yet)
- **Clear page**: alarms that received a Clear (with duration)
- **Dashboard**: statistics

Runs **locally on one machine with Docker Compose**, accessed by colleagues over the
LAN at `http://<host-ip>:3000`. No cloud services except Gmail API itself. Zero cost.

## 2. Working Rules (read every session)
- Language: **TypeScript everywhere** (Node 20). No Python.
- Everything runs in Docker. Do not install Postgres or pnpm globally on the host.
  Local dev may use `pnpm` inside the repo, but the deliverable is `docker compose up`.
- Before any command that destroys data (`docker compose down -v`, `prisma migrate
  reset`, dropping tables) → show the command and ASK first.
- Never ask the user for passwords, tokens or secrets in chat. Use `.env` (gitignored).
- `credentials.json`, `token.json`, `.env`, `data/` are in `.gitignore`. Never commit them.
- Write tests for the parser and the matching engine BEFORE building the UI.
- Keep "## 11. Current Status" at the bottom of this file updated after every phase.
- Prefer small, reviewable steps. Explain what changed after each step in 3–5 lines.

## 3. Stack
| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces: `apps/worker`, `apps/web`, `packages/core`, `packages/db` |
| Worker | Node 20 long-running process, `node-cron` every 1 min, in-process lock + `pg_advisory_xact_lock`; exposes `GET /health` on :4000 |
| Web | Next.js 14 (App Router) pages + NextAuth sign-in (`/api/auth/*`), `next start` on :3000, `HOSTNAME=0.0.0.0`; every other `/api/*` is rewritten (proxied) to the API |
| API | NestJS 11 (`apps/api`, Express, ESM) on :4100 (internal), global prefix `/api`; used by the web pages (session cookie) and the React Native app (Bearer token) |
| DB | PostgreSQL 16 container, data in named volume `pgdata`; Prisma ORM |
| Auth | NextAuth (Credentials provider), JWT sessions, roles `viewer` / `operator` / `admin` (office admin) / `super_admin` (2026-10-20) |
| UI | React + Tailwind + shadcn/ui, TanStack Table, Recharts |
| Excel export | `exceljs` |
| Gmail | `googleapis` npm, OAuth2 Desktop client; `token.json` mounted read-only into worker |
| Backups | `backup` container: daily `pg_dump` to `./backups/`, keep 30 days |
| Tests | Vitest |
| Orchestration | `docker-compose.yml` (prod) + `docker-compose.dev.yml` (hot reload) |

## 4. Docker Layout
```
docker-compose.yml
  db       postgres:16-alpine, volume pgdata, healthcheck pg_isready
  migrate  one-shot: prisma migrate deploy + seed (depends_on db healthy)
  api      build apps/api (Debian + unrar), :4100 internal, mounts token.json + credentials.json:ro
  worker   build apps/worker, restart: unless-stopped, mounts ./token.json:ro
  web      build apps/web, ports 3000:3000, restart: unless-stopped
  backup   alpine + postgres-client, cron 02:00 pg_dump → ./backups
```
- All services on one network; only `web` (3000) is published. `db` is not exposed.
- Images: multi-stage, `node:20-alpine`, non-root user, `.dockerignore` present.
- `web` uses Next.js `output: 'standalone'` to keep the image small.
- Healthchecks on db, api (`/api/health`), web (`/login`) and worker (`/health`).
- `docker-compose.dev.yml` overrides: bind-mount source, `pnpm dev`, `next dev`.

## 5. Email Format
Alarm subject example:
```
S_D_N_BTS O&M LINK FAILURE on #451_S_BH-KOM-AZIZA_0D36DE# at |08-OCT-2026 11:01:03 |
```
**Confirmed from 300 real samples (2026-10-11, `samples/subjects.txt`):**
- **Clear = prefix `CLEARED_`** on the otherwise identical alarm subject. 85/85 clears use it;
  "clear" never appears anywhere else.
  `CLEARED_S_D_N_FENCE GATE ALARM on #SRAN_..._0732DE# at |11-OCT-2026 15:49:55 |`
- **A Clear carries the ORIGINAL alarm time, not the clear time.** Its subject time equals the
  alarm's subject time (seen with clears for alarms from 31-AUG / 24-SEP / 30-SEP).
  ⇒ the clear time must come from the Clear email's Gmail `internalDate` (`receivedAt`).
- Name prefixes seen: `S_D_N_` (most) and `D_S_`. Kept as part of `alarmName`.
- Some names are vendor-truncated (`SHELTER DOO`, `AIR CONDITIO`); the alarm and its Clear are
  truncated identically, so they are kept verbatim.
- Some names carry a `;Default System Time` suffix → split into `nameSuffix`, excluded from key.
- **Second format (32% of mail):** `Huawei Alram Notify New alarm: <NE>/<alarm>/<severity>`
  e.g. `...: Hossary-RNC27/UMTS Cell Unavailable/Major`. No time, NE is an RNC/BSC (not a
  site), and no Clear form was seen in the samples. Parsed as `format: "HUAWEI"`,
  `alarmTime: null`. **Decision (user, 2026-10-11): store in `raw_messages` only — the engine
  does not create alarms from them** until a Huawei clear format is seen.
- **ALARM_TZ = `Africa/Cairo`** (confirmed by user 2026-10-11; DST-aware, UTC+3 in summer).

Parser (`packages/core/src/parser.ts`, `parseSubject(subject, { timeZone })`) extracts:
| Field | Rule |
|---|---|
| `isClear` | subject starts with `CLEARED_` (case-insensitive) |
| `alarmName` | text before ` on #`, minus `CLEARED_` and minus any `;…` suffix (trimmed) |
| `nameSuffix` | text after `;` in the name, or null |
| `site` | text between `#` and `#` |
| `alarmTime` | text between `|` and `|`, format `DD-MON-YYYY HH:mm:ss`, wall-clock in `ALARM_TZ` (`Africa/Cairo`, confirmed), stored as UTC. For a Clear this is the original alarm's time |
| `alarmKey` | `${alarmName}||${site}` — **never includes time** |

**Email body (confirmed from 200 real bodies, label `dn-kafr-eldawar`, 2026-10-11)** —
`packages/core/src/body.ts`, `parseMessage(subject, body)`:
```
############NEW ALARM###########          (Clear: ############CLEARENCE ALARM###########)
ALARM NAME:        WCDMA CELL OUT OF USE   (each value is on the line after its label)
ALARM_START_TIME:  11-OCT-2026 21:02:49    (= subject time)
NE_name: RNC66 · Alarm_Number 7771 · ALARM_SITE: U_S_BH-MHLT-KYL_3830DE
cell name :        A_BH-MHLT-KYL_3_24313_S (only when ALARM_Device = cell)
ALARM_Device:      cell | MRBTS | site
CONSEC_NBR:        2291814
```
- **`CONSEC_NBR` is unique per alarm and the Clear carries the SAME number** (89/89 unique,
  79/79 clears matched). User rule (2026-10-11): the same subject (name + time) arriving
  again with a different body = a NEW alarm (e.g. another cell) — never a duplicate.
- With a body: `alarmKey = name||site||cellName` (cell only when present) and identity =
  `consecNbr`. Without a parseable body: subject rules only (key = name||site).
- Non-alarm mail in the label (e.g. "Nokia … Alarms Update Report") → parse_error, kept.

Unparseable subjects → stored in `raw_messages` with `parse_error`, never dropped.
`corepack pnpm parse:samples` runs the parser over all samples and lists failures.

## 6. Classification Rules
Stored in table `rules` (editable in UI). Seed:
- **DOWN**: `LINK FAILURE`, `BTS DOWN`, `CELL UNAVAILABLE`, `SITE DOWN`, `UNREACHABLE`, `NODE DOWN`
- **POWER**: `MAINS`, `AC FAIL`, `BATTERY`, `RECTIFIER`, `DC LOW`, `GENERATOR`, `POWER`
- **OTHER**: anything else
Match on `alarmName`, case-insensitive, first rule by `priority` wins.

## 7. Matching Engine (core logic — must be fully tested)
Runs for every new message, ordered by `alarmTime` then `receivedAt`.

**A. Alarm message (`isClear = false`)**
1. Alarm with same `alarmKey` AND same `alarmTime` exists → duplicate, ignore.
2. ACTIVE alarm with same `alarmKey` and OLDER `alarmTime` exists →
   close it: `status=CLEARED`, `clearType=AUTO_SUPERSEDED`, `clearTime=newAlarmTime`,
   then create the new alarm as ACTIVE.
3. Else → create new ACTIVE alarm.

**B. Clear message (`isClear = true`)**
1. Find ACTIVE alarm with same `alarmKey`. The Clear subject carries the original alarm's
   time (confirmed, §5): prefer the alarm whose `alarmTime` equals it; otherwise take the
   latest active.
2. Found → `status=CLEARED`, `clearType=EMAIL`, `clearTime = Clear email receivedAt`
   (Gmail `internalDate` — the subject time is NOT the clear time),
   `durationMin = clearTime - alarmTime`.
3. Not found → insert into `orphan_clears`. Never silently drop.

**C. Idempotency & safety**
- Dedupe on `gmailId` in `raw_messages`.
- Worker: in-process `running` flag + `pg_advisory_xact_lock(42)` per run.
- `alarmTime` comes from the subject, NOT the email received time. The ONLY exception is
  `clearTime` of an EMAIL clear, which is the Clear email's `receivedAt` (user decision
  2026-10-11, because Clear subjects repeat the alarm time).
- HUAWEI-format messages are stored in `raw_messages` but never create alarms (§5).
- `reprocess(days)` rebuilds alarms from `raw_messages` deterministically; running it
  twice yields identical results.
- Gmail sync: `users.history.list` from `SystemStatus.lastHistoryId`; on first run or
  `404 historyId too old` fall back to `messages.list` with `after:`.
- Process at most 200 messages per run; the next minute continues.

**E. CONSEC_NBR identity (added 2026-10-11, overrides A.1 / B.1 when the body has it):**
- Alarm with a `consecNbr` already stored → duplicate; otherwise it is a new alarm even if
  another alarm has the same subject/key-without-cell/time.
- Clear with `consecNbr` → closes exactly the alarm with that number; already closed →
  `stale_clear`; not found → orphan (stores `consecNbr`). NO "latest active" fallback.
- Orphan consumption matches by `consecNbr` when present.
- **No AUTO_SUPERSEDED for alarms with `consecNbr`** (user rule 2026-10-11, case
  NE3SWS on BH-KANAYES-VLG 22:47:39 #2300397 vs 22:50:40 #1113627011): same name + site at a
  new time, with or without a cell, is an independent alarm closed ONLY by its own Clear.
  A.2 superseding applies only to body-less alarms (and never touches alarms with consecNbr).

**D. Implemented edge-case rules** (`packages/core/src/engine.ts`, decided in Phase 4):
- Ordering within a batch: `alarmTime`, then alarms before Clears, then `receivedAt`, then
  `gmailId` — so a Clear delivered before its alarm in the same batch still matches.
- Clear whose exact `alarmKey`+`alarmTime` alarm exists but is already CLEARED → `stale_clear`,
  no-op (prevents the "latest active" fallback from closing a newer alarm; duplicate Clears).
- Alarm arriving when an orphan Clear with the same key + subject time exists → orphan is
  consumed, alarm created CLEARED/EMAIL with the orphan's clearTime; older actives superseded.
- Older alarm arriving after a newer ACTIVE one (same key) → created already CLEARED /
  AUTO_SUPERSEDED at the newer alarm's time (never two ACTIVE alarms per key).
- `durationMin` = rounded minutes, clamped at ≥ 0.
- `reprocess(days)`: since = now − days; delete alarms with alarmTime ≥ since, reopen alarms
  whose clearTime ≥ since, delete orphan clears whose raw message is in the window, then
  re-run all raw messages received ≥ since. Verified idempotent (memory + real Postgres).

Required test cases (Vitest, in `packages/core`):
1. Normal alarm → Clear 1 hour later
2. Alarm → Clear 1 day later
3. Alarm → same alarm with newer time (AUTO_SUPERSEDED) → Clear for the new one
4. Exact duplicate alarm email
5. Clear with no matching active alarm (orphan)
6. Out-of-order delivery (Clear email arrives before alarm email)
7. Subject that does not parse

## 8. Database Schema (Prisma)
```
RawMessage   id, gmailId @unique, subject, receivedAt, body?, parseError?, processedAt?
Alarm        id, alarmKey, alarmName, site, category(DOWN|POWER|OTHER),
             alarmTime, status(ACTIVE|CLEARED), clearTime?, durationMin?,
             clearType?(EMAIL|AUTO_SUPERSEDED), consecNbr? @unique, cellName?, device?, createdAt
             @@index([alarmKey, alarmTime]) @@index([status, category]) @@index([site])
             (alarmKey+alarmTime was @@unique until 2026-10-11 — two cells can share it)
OrphanClear  id, alarmKey, subject, clearTime, rawMessageId, consecNbr?
Rule         id, pattern, category, priority
Site         site @id, region?, owner?
User         id, email @unique, passwordHash, role(VIEWER|ADMIN)
SystemStatus id=1, lastHistoryId, lastRunAt, lastError?, lastRunMessages, reprocessDays?
```

## 9. API (NestJS, `apps/api` — refactored from Next.js Route Handlers 2026-10-21)
- `GET /api/alarms/active?category&site&region&minHours&page`
- `GET /api/alarms/cleared?from&to&category&site&page`
- `GET /api/stats/summary` → active counts per category, MTTR per category, last run
- `GET /api/stats/daily?days=30`
- `GET /api/stats/top-sites?limit=10`
- `GET /api/export?status=active|cleared&...` → .xlsx
- `GET|PUT /api/rules` (admin)
- `POST /api/reprocess?days=7` (admin) → sets `SystemStatus.reprocessDays`; worker picks it up
- `GET /api/health` → db ok + worker lastRunAt age

## 10. UI Pages
1. `/alarms` — active table; filters category/site/region in URL; live "age" column
   (30s); rows older than `ALERT_HOURS` (default 4) highlighted; auto-refresh 60s.
2. `/cleared` — cleared table; date range; duration; clearType badge; Excel export.
   50 clears per page (user request 2026-10-28; /alarms stays at 100).
3. `/dashboard` — counters per category, 30-day stacked bar, top-10 sites, MTTR,
   status bar "last sync X min ago" (red if > 5 min or `lastError`).
4. `/settings` — rules editor, users (admin only).
English UI, numbers LTR.

## 11. Environment (.env.example)
```
POSTGRES_USER=alarm
POSTGRES_PASSWORD=change-me
POSTGRES_DB=alarms
DATABASE_URL=postgresql://alarm:change-me@db:5432/alarms
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://<host-ip>:3000
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=
ALARM_TZ=Africa/Cairo
ALERT_HOURS=4
GMAIL_QUERY=            # optional Gmail search filter (first-run/backfill listing only)
OFFICE_LABEL_PARENTS=DN,DS     # the worker reads ALL mail; office = first label under these parents
```

## 13. Mobile (PWA first, Expo optional)
**PWA (Phase 9):** Next.js app becomes installable: `manifest.json`, icons, service
worker via Serwist, offline shell for /alarms. Web Push via `web-push` (VAPID keys in
`.env`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

**Remote access (Phase 10):** `cloudflared` container in docker-compose.yml using a
tunnel token (`CLOUDFLARE_TUNNEL_TOKEN` in .env) → `https://<subdomain>`; port 3000 stays
LAN-only. Access restricted by app login (and Cloudflare Access if available).

**Expo app (Phase 11, optional):** `apps/mobile` (Expo SDK 51, expo-router, TypeScript)
sharing types from `packages/core`. Auth via `POST /api/auth/token` (Bearer JWT, 30 days,
revocable). Push via Expo Push API. Distribution: APK for Android, TestFlight for iOS
(requires paid Apple developer account).

**Schema additions:**
```
PushSubscription  id, userId, platform(WEB|EXPO), endpoint (web) / expoToken,
                  keys? (p256dh, auth), createdAt, lastUsedAt
NotificationPref  userId @id, categories[], regions[], quietFrom?, quietTo?,
                  notifyNewDown bool, notifyOverdue bool
```

**Notification rules (run by worker after each sync):**
- New ACTIVE alarm with category DOWN → notify subscribers whose prefs match.
- ACTIVE alarm crossing `ALERT_HOURS` → one "overdue" notification per alarm, once.
- Batch: if > 3 events in one run → single summary notification ("5 new alarms").
- Respect quiet hours; drop subscriptions that return 404/410.

**Mobile screens:** Active list (oldest first, category color, pull-to-refresh,
site search) · Alarm detail (related messages, duration) · Cleared (last 24h) ·
Dashboard (3 counters + last sync) · Settings (notification prefs).

**API additions:** `POST /api/auth/token`, `POST|DELETE /api/push/subscribe`,
`GET|PUT /api/notifications/prefs`, `GET /api/alarms/:id`.

## 14. Hourly Reports (Nokia Down & Environmental, RAR attachment) — STATELESS
Emails under Gmail label `Hourly Update` carry a `.rar` with `NSN Update_Output.xlsx`.
**Alarm rows are never stored.** Processing is on demand, in memory, with a short cache.
The only persisted data: `SiteMaster` (enrichment) and `HourlyNormalization` (value fixes).

**Pipeline (apps/api services/hourly):**
1. `listReports()`: Gmail messages with label `Hourly Update` and an attachment →
   {gmailId, receivedAt, sender, fileName, fileSize}. No download.
2. `process(gmailId)`: download via `users.messages.attachments.get` → temp dir →
   validate (`.rar`, magic `52 61 72 21 1A 07`, ≤ 25 MB; after extraction ≤ 100 MB,
   ≤ 20 files, no `..`/absolute paths, exactly one .xlsx) → `unrar x -o+` →
   read sheets with exceljs → dedupe across `*_Down` sheets on
   (Distinguished Name, Alarm Text, Alarm Time), collecting `technologies[]` →
   join `SiteMaster` on Site Code → normalize → rows JSON → LRU cache
   (key gmailId, 30 min, max 20) → `finally` delete temp dir.
3. `rows(gmailId, filters)` and `export(gmailId, filters)` serve from cache; if the
   cache is cold, process() runs again transparently.
4. `diff(a, b)`: process both, return new / disappeared rows (by site+alarmName+dn).
Never execute anything from the archive. Never keep extracted files.

**Extraction requirement:** official `unrar` package (non-free). `p7zip`, `unrar-free`
and 7-Zip 23 FAIL on this RAR5 ("Unsupported Method"). Dockerfile:
`apt-get install -y unrar` (multiverse/non-free enabled); fallback `node-unrar-js`.

**File format (confirmed from a real sample):** sheets `All`, `2G_Down`, `3G_Down`,
`4G_Down`, `5G_Down`, `Environmental`, `HW`; same 14 columns, header in row 1:
Alarm Number | Alarm Type | Alarm Time | Alarm Text | Distinguished Name |
Object Class | Name | Site Name | Site Code | Site Address | Diagnostic Info |
User Additional Information | Supplementary Information | Related DN's
- Use the categorized sheets, not `All` (`All` adds ~740 TRX rows with empty sites).
- `Environmental`: real alarm is `Supplementary Information` (Alarm Text is constant).
- region = last 2 chars of Site Code (DE, UP, AL, SI, CA, RE).
- Flag Alarm Time year < 2020 as `clockInvalid`, keep the row.

**Output row (what the UI/export shows — matches the user's Excel):**
```
alarmTime | alarmText | name | siteName | code | office* | nodality* | vip* | siteType* |
powerSource* | battery* | supplementaryInfo | region | technologies | sheet | clockInvalid
```
`*` from SiteMaster; empty when the code is unknown (show a count of unmatched codes).
Rows colored by office in UI and export; default sort office, then alarmTime desc.

**Normalization (table `HourlyNormalization`, seed):** collapse double spaces, trim,
upper-case; `MAIN POWER CUTTOFF`/`MAIN POWER  CUT OFF` → `MAIN POWER CUT OFF`,
`SHELTER DOO` → `SHELTER DOOR`, `DAMNHOUR` → `DAMANHOUR`, `TEMPRATURE` → `TEMPERATURE`.

**Category (for the category filter only, not stored):** `*_Down` → DOWN;
Environmental with RECTIFIER|MAIN POWER|BATTERY|GENERATOR|SURGE → POWER; else OTHER.

**Schema:**
```
SiteMaster           code @id, siteName?, office, nodality?, vip bool, siteType?,
                     powerSource?, battery?, phone?, region?, notes?, updatedAt
HourlyNormalization  id, field, from, to
```
Import SiteMaster from an uploaded xlsx (sheet `SiteMaster`, columns Code, Site Name,
Office, Nodality, VIP, Site type, Power Source, Battery) — admin only; re-import upserts;
one file per office is fine (template: tests/fixtures/SiteMaster_KafrElDawar.xlsx).

**API (/api/v1):**
```
GET  /hourly-reports?from&to&page                     list from Gmail
POST /hourly-reports/{gmailId}/process                202 → poll GET status
GET  /hourly-reports/{gmailId}/status
GET  /hourly-reports/{gmailId}/rows?sheet&region&office&alarm&siteType&category&from&to&q&page
GET  /hourly-reports/{gmailId}/export?...same filters&columns=   xlsx
GET  /hourly-reports/diff?a=&b=
POST /site-master/import   GET /site-master   PUT /site-master/{code}   admin
GET|PUT /hourly-normalizations                                           admin
```

**UI `/hourly`:** reports list (time, sender, file, size, Process button, cache
state); results table with filters (sheet, region, office, alarm, site type, category,
time range, search by code/name), column chooser, office colors, filters in URL,
Export Excel reproducing the visible table; Compare view for two reports.
Mobile: list + read-only table with the same filters.

**Env:** `HOURLY_MAX_RAR_MB=25`, `HOURLY_MAX_EXTRACT_MB=100`, `HOURLY_CACHE_MIN=30`.

**As built (Phase 12, 2026-10-13) — built on Route Handlers, no separate api service:**
- Pure pipeline in `packages/core/src/hourly/` (validate, extract, parse, enrich, normalize,
  filter, diff, exportXlsx, siteMaster). `@alarm/core` re-exports only the browser-safe part;
  the server part is `@alarm/core/hourly`. exceljs / node-unrar-js are *optional peer* deps
  of core so the worker image does not grow.
- Server in `apps/web` (since 2026-10-21 in `apps/api/src/lib`, see "NestJS API"): `lib/gmail.ts` (list + attachment, worker's OAuth files;
  `HOURLY_GMAIL_MOCK_DIR` serves local .rar files), `lib/hourlyCache.ts` (LRU + in-flight
  promise + status, **per Next.js instance**), `lib/hourly.ts`; routes under
  `app/api/hourly-reports/**`, `app/api/site-master/**`, `app/api/hourly-normalizations`
  (paths without `/v1`), all `runtime = "nodejs"`, responses `{data, meta}` / `{error}`.
- Roles: new `OPERATOR` (viewer < operator < admin). Process = operator; Site Master and
  normalizations = admin. A report nobody processed yet returns 409 to viewers; once
  processed, a cold cache re-processes transparently for everyone.
- Extraction: headers listed with node-unrar-js first (pre-check), then `unrar x -o+ -p- -y`
  when the binary exists, else node-unrar-js; post-check on disk; temp dir removed in finally.
- `apps/web/Dockerfile` uses `node:20-bookworm-slim` (deviation from §4 Alpine): Alpine has
  no `unrar` package; Debian non-free has `unrar` 6.21 (verified).
- The /hourly page loads all rows of a report (rows API, pages of 500) and filters/sorts in
  the browser with the same core functions; export goes through the API with the same
  filters + visible columns. Report list paging is `page`, mapped to Gmail page tokens.
  `pageSize` (1–50, default 25) on `GET /api/hourly-reports`; the Hourly Alarms list asks for
  10 (user request 2026-10-29), Compare / "Compare with previous" keep 25.
- Deviations found in the real files: Environmental *Alarm Text* is NOT constant (EXTERNAL
  AL n, FIRE ALARM, … in a minority of rows) — alarmName is still Supplementary Information,
  falling back to Alarm Text when empty. Normalization rules replace whole words, and an
  `alarmName` rule also fixes Alarm Text / Supplementary Information.
- **Plain .xlsx attachments (2026-10-13, user request):** some mails carry
  `NSN Update_Output.xlsx` directly instead of a .rar. Attachment pick: .rar, else .xlsx.
  `.xlsx` path: extension, ZIP signature `50 4B 03 04`, ≤ HOURLY_MAX_RAR_MB, declared
  uncompressed size (ZIP central directory) ≤ HOURLY_MAX_EXTRACT_MB → parsed directly, no
  temp dir. Same rows as the RAR (test `process.test.ts`). Mock dir serves .xlsx too.
- **Table as image (2026-10-13, user request):** "Image for WhatsApp" on /hourly/[gmailId]
  (`components/hourly/table-image.tsx`): filtered rows drawn on canvas (office colors, title
  = report time, subtitle = active filters), split into 25/40/60/100 rows per PNG; compact
  column set by default or the table's visible columns. Images are split per category by
  default (DOWN / POWER / OTHER never share an image; checkbox to turn off; file names
  `hourly-<time>-down-1of2.png`). Share = Web Share API with files
  (phone + HTTPS only, e.g. Phase 10 tunnel); otherwise Download (and Copy image when the
  page is a secure context). No new dependency.
- **Site Master on the alarm pages + phone (2026-10-14, user request):** `site_master.phone`
  (migration `20261014000000_site_phone`) from the file's **Guard Number** column (also
  Phone / Phone Number / Mobile; `phoneText()` restores the leading 0 Excel drops, several
  numbers joined " / "). Alarm-mail sites are joined on `siteCodeOf(site)` = last "_" segment
  (`SRAN_LWG_TDD_S_BH-QMB-LOQIN_0H31DE` → `0H31DE`) in `lib/queries.ts withSiteInfo()` →
  `/api/alarms/active|cleared` + export add `siteCode, vip, nodality, battery, phone, siteType,
  powerSource` (null when the code is not imported). /alarms and /cleared show a VIP badge
  next to the site + Nodality / Battery / Phone (tel: link) columns and on the phone cards.
  Hourly rows have a `phone` column too (default visible; in the compact WhatsApp image with
  VIP + battery). Phone is editable in /settings/site-master. 2026-10-14: 116/286 alarm sites
  match (only the Kafr El Dawar file is imported); 102/136 sites have a phone.
- **Hourly output settings (2026-10-22, user request):** /settings/hourly, per user in
  `users.uiPrefs.hourly` (`packages/core/src/hourly/output.ts`, no migration — uiPrefs is JSON).
  Applies to the table, WhatsApp images, Excel (server reads the user's prefs in the export
  route) and the new client-side **PDF** (`components/hourly/table-pdf.tsx`, jspdf 3.0.3 +
  jspdf-autotable 5.0.2, loaded on click). Settings: hidden sheets / categories / alarm names
  (names listed from the newest processed report); table/Excel/PDF columns and image columns,
  each ordered (the page's column chooser edits the same list; localStorage no longer used);
  "sort by site code" = default sort office → code → newest (`HOURLY_SORT_BY_SITE`, ?sort still
  overrides); age colours = rules {hours, color}, the highest reached wins, whole row or chosen
  columns, over the office colour, age = report mail time (wall clock in ALARM_TZ) − Alarm Time,
  clockInvalid never coloured, default 3 h → red on; split = none | DOWN vs POWER+OTHER | each
  category, optionally per office → one image set / Excel worksheet / PDF section per group
  (default: each category, so Excel now has DOWN/POWER/OTHER sheets). New output-only columns
  `siteNo` ("Site #": 1, 2, … per distinct site code, last = number of sites) and `siteAlarms`
  (rows of that code), numbered per group by `numberSites()`; images/PDF/footer show "N sites".
- **Hourly settings are per OFFICE, admins only (2026-10-25, user request):** table
  `hourly_settings` (migration `20261025020000_hourly_settings`; key = office label, or "*" =
  default for offices without their own, seeded from the super admin's old
  `users.uiPrefs.hourly`, which is no longer read). `@alarm/db` `getHourlySettings(prisma, scope)`
  = own row → "*" → built-in; `hourlyEditKey(user, scope)`: office admin → their office, super
  admin → viewed office label, else "*" (all offices / a group), others → null. API
  `GET /api/hourly-settings` {data, meta {source, editKey, own}} for everyone, `PUT` / `DELETE`
  (back to the default) for ADMIN+; the Excel export uses the office's settings. Web: the (app)
  layout resolves them server-side → `components/hourly-prefs.tsx` (`useHourlyPrefs`), used by the
  report, compare, image / PDF export and column chooser (shown to admins only). The settings tab
  is ADMIN+ and shows whose settings are edited + "Use the default again".
- **Hourly settings redesign (2026-10-25, user request):** /settings/hourly ("Alarms, images &
  colours") — sections Alarms / Columns / Images / Sort / Colours are a gap accordion (separate
  collapsible cards, header = title + one-line summary of the current setting, several open at
  once, Alarms open by default; `Section` in the page) — no preview, ONE column list (`tableColumns`) for the table, images and Excel
  (`imageColumns` dropped). Prefs shape (`packages/core/src/hourly/output.ts`, old settings
  converted by `normalizeHourlyPrefs`): `sort` time | code (was `sortBySite`); `colors` = {enabled,
  rules: age {hours} | office {office}, each with colour + columns ([] = whole row)} (was
  `ageColors`) — **an office rule wins over age** (user choice), highest age period wins, else the
  built-in office colour. **Office colours list (2026-10-29, user request):** under the rules,
  every Site Master office with a colour picker → `colors.offices` {OFFICE: "RRGGBB"} = the
  Office cell's colour, and `colors.officeRowTint` (default on) = the office's other cells get
  `lighterColor()` (65 % toward white) of it, off = no colour there; an office left on Default
  keeps the built-in colour on the whole row; age rules still win. Same day (user request):
  **rules are age-only** — the "office" rule kind and the "Office rule" button are gone; on
  read, an old office rule becomes that office's entry in `colors.offices` (an existing entry
  wins).
  `images` = sets down / downSites / env / envVipNodal / power, each
  {enabled, byOffice} (byOffice only for down, env, envVipNodal) → `hourlyImageGroups()`: Down;
  Down sites = DOWN, all offices, first alarm per site code (siteAlarms keeps the site's count);
  Environmental = POWER + OTHER; Env · VIP / Nodal (separate image, user choice); Power only.
  Default: Down + Down sites + Environmental. `split` stays for the Excel API only.
  **Office groups (2026-10-29, user request):** a set that can split by office (down, env,
  envVipNodal) has a third mode — `HourlyImageSetPrefs` {enabled, byOffice, grouped},
  `hourlyOfficeMode()` all | each | groups. **Groups are automatic** (user, same day — the first
  hand-made group editor was replaced): `packOffices()` first-fit decreasing — whole offices,
  biggest first, into images of up to the export window's Rows per image; an office with that
  many rows or more stands alone ("DOWN · TANTA + BENHA"; inside an image the offices follow one
  another). `hourlyImageGroups(rows, images, rowsPerImage)`. Settings → Images: radio "Office
  groups" + a one-line explanation. No migration (prefs are JSON; old `groups` are dropped). Alarm hide
  lists = **Down** and **Environmental** from table `hourly_alarm_names` (migration
  `20261025000000_hourly_alarm_names`: name, section DOWN|ENV, category, lastCount, lastSeen),
  filled on every processing (`recordAlarmNames`) and by "Collect from the last 24 reports"
  (`POST /api/hourly-alarm-names/collect`, operator+, background, cached reports not re-downloaded;
  `GET /api/hourly-alarm-names` for everyone). First real run: 24 reports, 2 without a report
  file, 19 Down + 125 Environmental names. `alarmTexts` (migration
  `20261025010000_hourly_alarm_texts`, union of the Alarm Text values seen with the name) lets the
  settings search find Environmental alarms by their wrapper text "BASE STATION EXTERNAL ALARM
  NOTIFICATION" (120 names), shown as "Alarm Text: …" under each match. **A hidden name also
  hides rows whose Alarm Text is that name** (`visibleHourlyRows`, table + images + Excel), so a
  wrapper text added by hand ("Add an alarm by name", `POST /api/hourly-alarm-names` {name,
  section}, any user, 201 new / 200 existing) and unticked hides all its Environmental rows.
  **Alarms section redesign (2026-10-29, user request: "like the Display alarms editor"):** one
  list (All / Down / Environmental · All / Changed (n) · search name or Alarm Text) with, per
  name: section tag, a **category select** (`alarmCategories` {NAME: DOWN|POWER|OTHER}, only
  when it differs from the report's), last count, **Sites** (`alarmSites` {NAME: codes or full
  site names}: hidden → still shows there, shown → hidden there; matched on the row's alarm name
  or Alarm Text, code or site name) and Shown / Hidden (`hiddenAlarms`); Show all / Hide all for
  the listed rows; one "Add an alarm by name" with a Down / Environmental pick. Later the same
  day (user request): the Categories chips are gone (an old `hiddenCategories` value shows an
  amber "Show them again" note) and the Sheets chips + both tab rows became select boxes in
  one h-8 row with the search — Sheets (MultiSelect, none ticked = all, an "All sheets" line on
  top via the new `allOption` prop), Down + Environmental / Down / Environmental / Power (Power
  = the name's category, changed or not), All alarms / Changed (n). `visibleHourlyRows` applies the category first (`hourlyRowCategory`, so
  hidden categories and the image sets see the new one), then typeHidden XOR excepted.
  `SiteList` / `VisibilityButton` are exported from `components/types-visibility-editor.tsx`.
- **Image settings gear on "Table as image" (2026-10-29, user request, like the alarms image):**
  the gear in the window header opens "Image settings" (z-60) with tabs **Images** (the image-set
  checkboxes of this export, moved out of the options row) and **Share settings** — per user in
  `uiPrefs.hourlyShare` {mode all | office, all, offices {SITE MASTER OFFICE: chat}}
  (`normalizeHourlyShare`, `ChatInput` from alarm-image.tsx). Office mode: each office with a
  saved chat gets the same image sets drawn from ITS rows only (per-office split off), and Send
  delivers them to that chat; `savedChats()` (API allow-list) includes these chats.
- **Report page trimmed (2026-10-25, user request):** /hourly/[gmailId] header keeps only "Export
  image" (was "Image for WhatsApp") and "Compare with previous" — Copy as table, PDF and Export
  Excel buttons removed from the page (the export API, `copyRows` and `TablePdfButton` remain).
  Columns chooser sits in the filter bar; Region filter removed from the UI; Office filter only
  for the super admin. Sidebar narrowed to w-52 (208 px). Compact filter box: sheet tabs row
  (hidden scrollbar) with Clear + Columns on its right, then an even grid of h-8 controls
  (2 / 3 / 4 / 8 columns by width) — Search, Office, Alarm, Site type, Category, VIP, and one
  "Alarm time" field holding from–to. Header order: Compare with previous, then Export image
  in the brand colour. No "All reports" link (the sidebar has Hourly Alarms). A "Filters" button
  (count of active filters) folds the filter grid away; open/folded is remembered per browser
  (localStorage `hourly.filtersOpen`).
- Fixture counts (tests/fixtures/NSN Update_Output.rar, 13-OCT-2026 ~07:00): data rows
  2G_Down 529, 3G_Down 434, 4G_Down 438, 5G_Down 2, Environmental 1394, HW 35; 856 unique
  Down rows after dedupe (181 SYNCHRONIZATION rows merged across 2G/3G/4G); 2,285 rows total.
  The counts in the task brief (743/499/469/3/1289/45) belong to a different report.
  SiteMaster fixture: 138 rows, 0970DE three times → 136 imported, 2 skipped.

## 12. Current Status
- [x] Phase 0 — repo, tooling, Docker skeleton (db healthy on Docker 29.8.2 / WSL2)
- [x] Phase 1 — Gmail OAuth + sample fetch (token.json saved; 300 samples in samples/subjects.txt)
- [x] Phase 2 — parser + tests (26 tests, 300/300 samples parse; ALARM_TZ=Africa/Cairo
      confirmed; clearTime = Clear receivedAt; Huawei = store only)
- [x] Phase 3 — Prisma schema + db container (init migration applied, 13 rules seeded;
      admin user is created on the next `docker compose run --rm migrate` once
      ADMIN_PASSWORD is set in .env)
- [x] Phase 4 — matching engine + tests (20 engine tests incl. the 7 required + reprocess
      idempotency; PrismaAlarmRepository verified by integration test on compose db)
- [x] Phase 5 — worker container (node-cron; healthy, ~200 msgs/min backfilling 24h; image
      144MB on disk — `docker images` shows ~242MB because it counts the base image's npm layer)
- [x] Phase 6 — Next.js API + auth (all §9 routes, zod, NextAuth JWT roles, exceljs;
      7 integration tests on alarms_test; login page at /login)
- [ ] Phase 7 — UI pages
      (2026-10-22, user request: dark navy theme + left sidebar instead of the top navbar.
      The theme lives in `apps/web/tailwind.config.ts`: `slate` is INVERTED (slate-50 = page bg,
      slate-900 = brightest text), `bg-white` = navy card, tinted colours 50–300 = dark tints and
      700–900 = light text, `brand` (teal) = primary/selected. Dark only, no light toggle.
      Sidebar = `components/nav.tsx` (fixed w-64 on md+, drawer + top bar below md).)
      (2026-10-22, user request: settings redesign. Settings is for EVERY user now, with its own
      sections — since 2026-10-25 a tab row along the top (underline tabs, thin dividers between
      the groups, scrolls sideways on narrow screens with the current tab kept in view, icons only
      on 2xl) instead of the left section sidebar (`app/(app)/settings/layout.tsx`, routes /settings/general | notifications |
      alarms/display | alarms/classification | hourly | users | gmail | site-master,
      shown by role). /preferences and /notifications redirect to /settings/notifications.
      2026-10-25: Office view + Reprocess are cards on /settings/general (super admin only, under
      the Theme); /settings/office and /settings/reprocess redirect there. The super admin can also
      view a whole **office group** ("All DN offices" / "All DS offices" → users.office = "DN"):
      a scope without "/" is a group (`isOfficeGroup`, `officeInScope`, `officeGroups` in
      `packages/core/src/roles.ts`); `officeWhere()` = `office startsWith "DN/"`, raw SQL via
      `alarmScopeSql()` {allOffices, officeExact, officePrefix}, Site Master / hourly rows via
      `siteOfficeMatcher()` (match keys of the group's labels). In a group view /alarms offers the
      Office filter limited to that group; the sidebar pill shows "DN · All offices".
      Per-user UI settings in `users.uiPrefs` (migration `20261022000000_user_ui_prefs`,
      `packages/core/src/uiPrefs.ts`, GET|PUT `/api/me/ui-prefs`, auto-saved by
      `components/ui-prefs.tsx`): theme `blue` (the navy default) | `dark` | `light`, rendered as
      `<html data-theme>` by the root layout; VIP / Nodality / Battery as icons; hidden columns per
      table (active / cleared); "one row per site code" grouping (siteCode ?? site, current page
      only; click the row to expand). Themes: every Tailwind colour is a CSS variable generated per
      theme in `tailwind.config.ts`; the sidebar stays dark in the light theme (data-theme="blue"
      on it). **"Show borders"** switch under the theme cards (2026-10-27, `uiPrefs.borders`, default
      on): off → `<html data-borders="off">` (root layout + `ui-prefs.tsx` live), `globals.css`
      makes `--border` and border-slate-100/200 + divide-slate-100/200 transparent; slate-300
      (checkboxes, radio circles), coloured borders and inputs / selects keep theirs.
      2026-10-28 (user request): **borderless is the default** (`borders: false`). In borderless
      mode, tints replace the lines (base layer, `:where` = zero specificity, so an element's own
      bg-* still wins): table header keeps the same colour as with borders on (user), striped rows (+ hover), striped divide-slate lists,
      and boxes with a full grey `border` become soft slate-100 panels (dividers stay plain).
      Integration tests share alarms_test — run them with `--no-file-parallelism`.)
      (2026-10-24, user request: **Mail view** of /alarms and /cleared — `uiPrefs.alarms.view`
      `table | mail`, switch in the page header; `components/alarm-mail.tsx`. Gmail-style card:
      the real mail subject, label chips ALM/CLR (from status), office, GEN, NDLN, VIP, BAT / NO BAT,
      then the mail's other Gmail labels; age (active) or duration (cleared) top-right; Cell and
      Device; "Received HH:mm (n min ago)" (+ Alarm mail / Clear mail times when cleared); green
      call button bottom-right (`tel:`, several numbers → pick list). A flag shows when Site
      Master says so OR the mail has the label (`packages/core/src/siteFlags.ts`): GEN = power
      source contains "DG"; **nodal = any nodality except "1+0"** (also used by the Nodality icon).
      `alarms.rawMessageId` / `clearMessageId` (migration `20261024000000_alarm_mail_links`,
      backfilled by CONSEC_NBR) link an alarm to its alarm mail / Clear mail; set by the engine.)
      (2026-10-24, user request: **/site-master page** in the main sidebar, every user, office-scoped
      list (`GET /api/site-master?q&office&vip&nodal&generator&battery&siteType&page`, q = code /
      name / phone / location; `meta.canManage`). Admins: "Add site" window (`POST /api/site-master`),
      Edit window (PUT), Delete (`DELETE /api/site-master/:code`), "Import Excel" window + template
      (`GET /api/site-master/template`). Office admin (ADMIN) manages only sites whose Site Master
      office matches their office label (others 404 / 403; import skips them); super admin all.
      2026-10-25 redesign (user request): the list shows only Code (copy icon), Site name, Office,
      Flags + a "Details" button → `SiteDetailsDialog` (`components/site-master/dialogs.tsx`) with
      every field and Copy (`siteWhatsAppText()`, `packages/core/src/siteMessage.ts`) / WhatsApp
      (wa.me) for everyone, Edit / Delete for managers (after Edit → back to Details); location = address / "lat, long" / Maps
      link (`site_master.location`, migration `20261024010000_site_location`). /settings/site-master
      now holds only Value normalization.
      **Import reads the network DB layout (DNTH DB):** sheet `Sites` (Site Code, SC Office,
      Nodal Deg. N → "1+(N-1)", Cascade Type → siteType, VIP, Battaries Status), generator sheets
      (`OR GEN Sites` Power Configuration, `Rental GEN` → "Rental GEN") patch powerSource, codes on
      `Dismantle` are skipped. **Only the columns present in the file are written** (`columns` in
      the parse result) — a file without phones keeps stored phones. Generator = power source with
      DG / GEN / HGB; battery status is free text → `batteryState()` ok / weak / none / unknown.)
      (2026-10-25, user request: **/alarms redesign.** Category tabs All / Down / Power / Other with
      counts (`/api/alarms/active` returns `categories` = count per category with every other filter);
      filter bar = Search (`q`: alarm name / site / site code / cell), Site tag (`flag` vip | nodal |
      generator — Site Master or the mail's Gmail label, alarms.siteCode) and, only for a super
      admin viewing all offices, Office (`office`, plus `offices` counts in the response; ignored
      for office users). Region / Older-than are no longer in the UI (API still accepts them).
      Table / Mail switch moved from the page headers to Settings → Display alarms, with per-user
      mail-card parts `uiPrefs.alarms.mail` (`MAIL_PARTS`: tags, labels, age, cellDevice, phone,
      category, received, raised; default = mail view with tags, labels, age, cell / device,
      call button). **Site tags** `siteTags()` (`packages/core/src/siteFlags.ts`) are text only,
      VIP · NODAL · BATT · GEN, shown only when the site has them (BATT = batteryState ok) — used
      by the mail cards, the table "tags" option and the Site Master page. The office chip is gone
      (office labels / nested "DN/…" labels never show). **Generator excludes another company's
      power** (`otherOperatorPower()`: a VF / ET / WE word, also "ETDG", "DGVF"): "DG/VF", "ETDG",
      "DG/ET" are not GEN — everywhere: tags, the alarms Site-tag filter and the Site Master
      Generator filter (codes picked with hasGenerator(), not SQL LIKE). Smaller corners on
      the alarm cards, tags and tabs.)
      (2026-10-26, user request: **/alarms "Export image"** replaces the Excel Export button (the
      `/api/export` API stays). `components/alarm-image.tsx`: loads every active alarm of the
      page's filters (pages of 500, category tab NOT sent — the tab only picks the sites), folds
      them to ONE ROW PER SITE (`siteImageRows`, `packages/core/src/alarmImage.ts`; site shown as
      `shortSite()` = last two "_" parts, e.g. BH-MADIA-RASHD_0342DE; time = oldest alarm). Columns
      (`ALARM_IMAGE_COLUMNS`, default time · site · age · down · power; also other, office,
      alarms, tags, phone): Down / Power / Other = "✓" or "✓ n" on the category colour (red-300 /
      amber-300 / slate-300), empty when none; age cell red-100 past ALERT_HOURS. Sites with alarms
      only in hidden category columns are left out (`visibleSiteRows`). Sort oldest | newest |
      down first | power first | site (`sortSiteRows`). All offices in one table or one per office
      (super admin, several offices). Settings saved per user in `uiPrefs.alarms.image`. Drawing +
      the Share / Download window moved to `components/image-export.tsx`, shared with the hourly
      image (`table-image.tsx` now uses it). Share button = green **WhatsApp** button (no menu,
      user 2026-10-26): opens `whatsapp://send` on a touch device, else web.whatsapp.com in a new
      tab. A page cannot hand files to WhatsApp, so it first copies the image to the clipboard
      (one image, secure context) or downloads the images to attach. Web Share sheet removed.
      2026-10-27 (user request): image columns **VIP** (✓) and **Nodal** (Site Master nodality,
      "✓" when only the mail label says nodal). 2026-10-28: no "Office" sort; with all offices in
      one table the rows are grouped by office name first, the chosen sort inside each office.
      2026-10-28 (user request): VIP column = YES / NO (Site Master, or YES from the VIP mail label;
      empty when unknown), Nodal = the Site Master nodality ("1+0", "1+2"; "NODAL" when only the
      label says so). A "Settings" button opens a panel: a colour per office (fill of the Office
      cell, `image.officeColors` {office name: "#rrggbb"}, per user) and the WhatsApp number
      (`image.whatsappPhone`, `whatsappNumber()`: digits with country code, Egyptian 01… → 201…);
      the WhatsApp button then opens `whatsapp://send?phone=` / `web.whatsapp.com/send?phone=`. Bug fix:
      the image settings were never saved — the `PUT /api/me/ui-prefs` zod schema dropped
      `alarms.image`; it is accepted now, and the window shows "Settings saved".
      2026-10-28 (user request): the settings button is a gear icon at the right end of the action
      row (WhatsApp / Download, aligned with the select boxes); the colour swatch circles are gone
      (colour picker + clear only). **Share chats** replace the single number: `image.shareAll`
      (number or group invite link, gets ALL images; old `whatsappPhone` converts into it) and
      `image.shareOffices` {office name: number or group link} (gets only that office's images —
      drawn per office even when the shown images are one table). `whatsappTarget()` /
      `normalizeWhatsAppTarget()` / `whatsappUrl()` in `alarmImage.ts` (group → web.whatsapp.com/
      accept?code= on desktop, chat.whatsapp.com/<code> on a phone). The dialog's "Send to N
      chats" walks the chats ONE CLICK EACH (copy one image / download, open the chat; chips show
      which are done): a browser cannot post images to several chats in one click — true
      one-click sending would need a server-side WhatsApp integration.
      Later the same day (user: "opens the chat without the images"): the gear sits in the window
      header next to Close, Send / Download stay in the options row. Share has a switch
      `image.shareMode` all (every image → shareAll) | office (each office chat → its images);
      old prefs with only office chats become "office". Delivery (`deliver()` in
      `image-export.tsx`): phone or no clipboard → Web Share sheet with the files (images go in,
      the user picks the chat); computer → copy image 1 + open the chat, then a green bar "Copy
      image n of N" to paste each; plain http on the LAN (no secure context) → download + open
      the chat, with a note that HTTPS (Phase 10) or localhost sends them directly.
      User report "each Send opens another WhatsApp tab / only the chat, no images":
      `openWhatsApp()` (image-export.tsx, also used by the Send panel) opens web links in ONE
      named tab "alarm-filter-whatsapp" (no noopener — Chrome ignores the name with it; opener
      nulled after). After a copy, an amber bar stays until Done: "Image n of N is copied — click
      the message box in WhatsApp and press Ctrl+V", with "Copy image n+1". Images still cannot
      be attached by a link; real automatic sending needs a server-side WhatsApp sender.
      Category select in the window (user request): All categories / Down / Power / Other /
      Power + Other (`ALARM_IMAGE_CATEGORIES`), starting at the page's tab on every open
      (`imageCategoryOf`); picks the sites (`sitesWithCategories`) and the time / count categories
      (`shownCategories` takes a list); the image subtitle starts with the choice (the page no
      longer puts the tab in it). Split choices (user request): "All categories · one table",
      "All · one table per category" (Down, Power, Other) and "All · Down | Power + Other" — each
      choice has `tables` [{label, cats}]; every table gets its own image set (and per office when
      split by office), title/subtitle/file name carry the table word, an empty table is skipped
      in a split, and a site with alarms of two tables is in both. `choiceCategories(id)` = the
      categories the choice covers ([] = all).
      Later (user request): the gear opens its own centred **Image settings** window (z-60 over
      the export window) with tabs Columns (the column checkboxes, moved out of the options row)
      · Office colours · Share settings, and a Done button; the options row keeps Rows per
      image, Sort, Offices.
      Bug fix 2026-10-28: a site row's Time / Age / sort used the oldest alarm of ANY category
      (the image loads every category), so in the Power tab a site showed the time of an older,
      hidden Other alarm. Now `withShownTime(rows, shownCategories(columns, tab))` = oldest alarm
      of the tab's category, else of the shown Down / Power / Other columns (`firstTime` per
      category on SiteImageRow); the footer / summary alarm count uses the same categories.)
      (2026-10-28, user request: **floating "Send" button** on /alarms and /cleared, bottom-right
      like a WhatsApp chat button — `components/send-panel.tsx`, mounted once in the (app) layout
      (shown by pathname; main got pb-24 so it never covers the pager). Only for office admins
      (ADMIN) and operators (user request 2026-10-29; viewers and the super admin do not see it). Panel with tabs **Mail**
      (bullets + the latest 200 active alarm mails) and **Update** (bullets + the latest 200 Clear
      mails, last 24 h); search, click a subject to add it as a bullet. Office name on top
      (`officeTitle()`), Enter adds a bullet, Backspace on an empty one removes it; drafts per tab
      in localStorage `send.mail` / `send.update`. Message = `updateText()` ("*Office* · time",
      "• line" each, `packages/core/src/sendUpdate.ts`). Copy (clipboard, execCommand fallback on
      http) and Share: `whatsappTextUrl()` pre-fills the text for a number or the chat list; a
      group link cannot carry text, so it is copied first and the group opens; on a phone with no
      chat set, the share sheet. Chat saved per user in `uiPrefs.alarms.sendChat`. Assumption:
      the user did not describe the Mail tab — built as the alarm-mail twin of Update.
      Same day (user request): the window is a centred modal (Esc / backdrop close; the round
      button hides while it is open). Message area = office name · **Teams** bullets (teams only)
      · **Notes** textarea · the added **Clears** (Mail tab: Alarms) as plain lines, removable;
      the "Latest clears" search list sits at the bottom. `updateText(title, time, {bullets,
      notes, mails})`: head, "• team" lines, notes, empty line, one subject per line. Drafts are
      {bullets, notes, mails} (the first list-only draft becomes bullets).
      WhatsApp message tidy-up (user screenshot: English lines right-aligned on an Arabic phone):
      every line starts with U+200E (left-to-right mark) — WhatsApp takes a line's direction from
      its first strong letter, and "•" / "-" have none. Blocks split by empty lines: head
      ("*Office* · 28 Oct, 20:01", no seconds), "*Teams*" + "- team" (WhatsApp list syntax),
      notes, "*Cleared (n)*" (Mail tab "*Alarms (n)*") + "✅ / 🔴 NAME — SHORT_SITE" via
      `mailLine()` (no CLEARED_ / S_D_N_ / D_S_ prefix, `shortSite()`, no subject time).
      List below the message (user request): a category select box (All categories / Down /
      Power / Other, with counts; was chips) next to the search; only the newest 20 show until you search, then every match
      (the panel loads the newest 500 of the tab — Clears: last 24 h).)
- [x] REST API moved to NestJS (2026-10-21, user request, for React Native): see "NestJS API" below.
- [ ] Phase 8 — full compose, backups, LAN access, 24h parallel run, RUNBOOK
      (RUNBOOK.md started with the hourly section; `apps/web/Dockerfile` exists but `web` is
      not in docker-compose.yml yet — it must mount token.json + credentials.json read-only)
- [ ] Phase 9 — PWA + web push
      (2026-10-29, user request "add progressive app" — **installable app done, web push not yet**):
      `app/manifest.ts` (/manifest.webmanifest: name, start_url /alarms, standalone, navy theme,
      icons any + maskable, shortcuts Alarms / Cleared / Dashboard); icons in `public/icons/`
      made by `scripts/make-icons.mjs` (the sidebar logo: Lucide radio tower on the teal tile;
      re-run after a design change); `public/sw.js` hand-written instead of Serwist (no new
      dependency): pages network-first with the last good copy offline, else `/offline.html`;
      `/_next/static` cache-first except in dev (`/sw.js?dev=1`); /api and non-GET never touched.
      `components/pwa.tsx`: `PwaRegister` (root layout) registers it in a secure context and
      keeps the install offer → "Install app" in the sidebar; sign-out clears the cached pages
      (`clearOfflinePages`). Root layout: theme-color, apple-web-app, icons. middleware lets
      manifest / sw.js / offline.html / icons through without sign-in; web Dockerfile copies
      `public/`. Verified on localhost:3000: worker activated and controlling, offline shell
      cached. **Only HTTPS or localhost** can install / run a service worker — phones on
      http://<LAN IP> cannot until Phase 10 (or Chrome's "insecure origins treated as secure" flag).
- [ ] Phase 10 — Cloudflare Tunnel remote access
      (2026-10-29, user choice "quick test tunnel" so phones can install the app: a Cloudflare
      **quick tunnel**, no account — `docker run -d --name alarm-quick-tunnel
      --add-host=host.docker.internal:host-gateway cloudflare/cloudflared:2024.12.2 tunnel
      --no-autoupdate --url http://host.docker.internal:3400`; its random
      https://….trycloudflare.com address (in `docker logs alarm-quick-tunnel`) changes on every
      start and must be put in the `web-tunnel` launch config's NEXTAUTH_URL (next dev on :3400,
      API on :4100). Reachable from the internet, protected only by the app login. Stop:
      `docker rm -f alarm-quick-tunnel` + stop `web-tunnel`. The permanent named tunnel (token
      in .env, cloudflared service in compose) is still to do.)
- [ ] Phase 11 — Expo mobile app (optional)
- [x] Phase 12 — Hourly reports (stateless, §14 "As built"): /hourly, /hourly/[gmailId],
      /hourly/compare, /settings/site-master. Verified 2026-10-13: vitest 151 tests incl. 7
      hourly route tests on alarms_test, and the Playwright smoke (`corepack pnpm test:e2e`,
      ~5 min — dev-mode cold compiles). e2e DB seeding runs in a child node process
      (`e2e/db.mjs`): importing ESM `@alarm/core/hourly` through Playwright's loader hangs.
      `apps/web/Dockerfile` not built yet.
Notes:
- pnpm is NOT installed globally (§2). Run it via corepack: `corepack pnpm <cmd>`
  (version pinned by `packageManager` in root package.json). `pnpm dlx` is broken on this
  host (Windows cache ENOENT) — use `npx` for one-off generators.
- Host has Node 24; Docker images use `node:20-alpine` per §3 — user decision 2026-10-11
  to keep it despite Node 20 being EOL since April 2026 (revisit if security updates matter).
- `next.config.mjs` emits `output: 'standalone'` everywhere except native Windows builds
  (needs symlink privilege); the Docker (Linux) build always gets standalone.
- DB tables are snake_case (`raw_messages`, `alarms`, `orphan_clears`, `rules`, `sites`,
  `users`, `system_status`). Extra indexes beyond §8: raw_messages.receivedAt (reprocess),
  orphan_clears.alarmKey, rules.priority. Rule priority: lower number = checked first.
- Seed is idempotent: rules only inserted when the table is empty; admin created once, never
  overwritten. New migrations: edit schema, then
  `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
  (needs a shadow DB) or `prisma migrate dev` against the dev-override db on 127.0.0.1:5432.
- Integration tests (`packages/db/src/repository.test.ts`, `apps/api/src/test/*.integration.test.ts`)
  run only when `TEST_DATABASE_URL` is set and must point at the separate **`alarms_test`**
  database (created + migrated in Phase 6), never at `alarms`.
- Local dev: ALWAYS start compose with both files
  (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d ...`). Plain
  `docker compose up` recreates db without the 127.0.0.1:5432 port and `pnpm dev` loses the DB.
  `apps/web/.env.local` (gitignored, generated from `.env`) points the dev server at it.
- API: every route except `/api/health` and `/api/auth/*` requires a session (401 JSON);
  `/api/rules` and `/api/reprocess` require ADMIN (403). Pages are guarded by `middleware.ts`
  (redirect to /login). `PUT /api/rules` replaces all rules and re-classifies existing alarms.  MTTR = avg durationMin of EMAIL clears only (AUTO_SUPERSEDED excluded), last 30 days.
  `/api/health` is 200 whenever the DB answers (worker staleness reported in the body).
- Classification gap seen on real data: OTHER dominates because seed rules don't match
  `BCCH MISSING`, `WCDMA BASE STATION OUT OF USE`, `NE3SWS AGENT NOT RESPONDING…` — ask the
  user whether these should be DOWN (editable in /settings once Phase 7 is done).
- Worker (`apps/worker`): mounts BOTH token.json and credentials.json read-only (refreshing
  the access token needs the client secret). Sync never advances `lastHistoryId` until every
  discovered message is stored, so the 200/run cap can't lose mail. First run / expired
  history → messages.list for the last `INITIAL_BACKFILL_HOURS` (24). `GMAIL_QUERY` only
  applies to that fallback listing (history.list has no query). /health is 503 only when
  runs stop (> 5 min); a Gmail error shows in `lastError` but stays 200 to avoid restart loops.
- 2026-10-11 body/label change: worker fetches `format: full`, stores the plain-text body in
  `raw_messages.body`, and reads only `GMAIL_LABELS` (history.list per labelId +
  messages.list `(label:a OR label:b)`). User approved wiping raw_messages/alarms/orphan_clears
  (9,188 / 2,516 rows) and re-syncing; rules + users kept. More labels: user to send names.
- **Office selection (2026-10-12, user request; superseded 2026-10-20 — see "All mail, offices
  and roles"):** offices = Gmail labels under `DN/` and `DS/`
  (DN: Damanhour, Dumiat, Kafr ElDawar, Kafr ElSheikh, Mansoura, Port Said, Tanta; DS: Benha,
  Dyrb Negm, Faqous, Huawei, Sadat, Shebin, Zagazig). The worker refreshes the list into
  `system_status.availableLabels` every 10 min (`OFFICE_LABEL_PARENTS`, default `DN,DS`).
  An admin picks ONE in /settings → `system_status.officeLabel`; the worker reads only that
  label, and when it differs from `syncedLabel` it backfills 24h for the new label.
  `raw_messages/alarms/orphan_clears.office` tag every row; every page/stat/export is scoped
  to the selected office (history per office is kept). `GMAIL_LABELS` is only the fallback
  before an office is chosen. Header shows the office pill.
- **Notifications (2026-10-12, user request):** in-site only (user choice; browser pop-ups
  need HTTPS on the LAN). Event = NEW alarm. Per-user prefs in `users.notifyPrefs`
  (`packages/core/src/notify.ts`: enabled, sound, categories, alarmNames (exact), sites
  (substring); OR within a filter, AND across, empty = any; default DOWN only). Feed is
  computed on read: alarms with `createdAt` in the last 24h in the selected office matching
  prefs; unread = `createdAt > users.notificationsSeenAt` (first time: last 30 min). Bell
  polls `/api/notifications` every 30s → badge, beep (WebAudio), pop-up card, "(n)" tab title.
  Prefs page `/notifications` (every user). Caveat: `reprocess` recreates alarms (new
  createdAt) → they can show up again as unread once.
- **Hidden alarm types (2026-10-12, user request):** admin hides whole categories and/or exact
  alarm names in /settings ("Displayed alarm types") → `system_status.displayFilter`
  `{hiddenCategories, hiddenAlarmNames}`, global (all users, all offices). `lib/visibility.ts`
  `alarmScope()` = office AND not hidden; used by every alarm list, stat (incl. raw-SQL daily
  chart via `alarmScopeSql()`), export and the notification feed. User filters are AND-ed on
  top, so they cannot un-hide. Data is still ingested/matched; pages show an amber
  "N alarm types hidden" note. `/api/alarm-names?all=1` includes hidden names (with `hidden`).
- **Personal hidden types (2026-10-12, user request):** every user can also hide types from
  THEIR pages only → `users.displayPrefs` (same shape), edited on `/preferences` (renamed from
  /notifications, which redirects; header link "My preferences"). `alarmScope(userId)` merges
  admin + personal; all routes pass `Number(session.user.id)`. Personal hiding also filters
  that user's notification feed. Admin-hidden types show as locked in the personal editor
  (shared component `components/types-visibility-editor.tsx`, mode admin|personal).
- **Site exceptions for hidden types (2026-10-25, user request):** both filters (admin and
  personal) have `exceptSites` (upper-case site codes or full site names, ≤ 200): the hidden types
  still show at those sites (`displayHides()` in `packages/core/src/displayFilter.ts`). The two
  filters are no longer merged — `alarmScope()` ANDs one condition per filter: NOT (hidden
  category / name) OR siteCode ∈ exceptSites OR site ∈ exceptSites; the daily chart's raw SQL
  (`alarmScopeSql()` → `admin`, `mine`) does the same with `upper(site)`. Edited under "Except
  these sites" in each hide/show section of Settings → Display alarms.
  **2026-10-27 (user request): exceptions are PER ALARM NAME** — `siteExceptions: {name: sites[]}`
  replaces the global `exceptSites` (old values are converted onto every hidden name by
  `normalizeDisplayFilter`). At its sites a name does the OPPOSITE: hidden → still shows, shown →
  hidden (`displayHides` = typeHidden XOR excepted). Prisma `visibleWhere()` builds it per name
  (null-safe `siteNotIn`); the daily chart SQL compares `typeHidden = inExceptions` with the
  exceptions passed as JSON. The Categories part is gone from the editor (hiddenCategories still
  applies; an old value shows an amber "Show them again" note). Each name row has a "Sites" button
  that opens its site list; the list filter is All / "Changed (n)" (hidden or with exceptions).
- **Display alarms page (2026-10-25):** a gap accordion (`components/settings/accordion.tsx`
  `AccordionSection`, shared with the hourly settings): View · Mail cards · Table site details ·
  Table rows · Table columns · my hidden types · hidden for everyone. Mail cards has its own
  section with **"Group alarms of the same site"** (`uiPrefs.alarms.mailGroupBySite`): on the
  current page, alarms with the same site code (else site) fold into one card — site, tags,
  "N alarms", categories, the alarm names, newest age — that opens to their mail cards.
  2026-10-27 redesign (user request): the View is a two-card picker (Mail cards / Table) above the
  accordion; groups "View" · "Layout" · "Hidden alarm types"; the three table sections are ONE
  "Table" section (Site details · One row per site code · Columns); the section of the chosen view
  is marked "In use", listed first and open. Mail cards = toggles left, sticky preview right (lg).
  Hidden-types editor: Categories → Alarm names (All / "Hidden only (n)" filter) → Except sites.
  `AccordionSection` got `icon` and `badge` props.
  Later the same day (user request): one section open at a time (`AccordionGroup` in
  `components/settings/accordion.tsx`, sections told apart by title; the hourly settings page
  does not use it) and no previews (mail card / site cell previews removed).
- After a schema change, RESTART `next dev` — a running dev server keeps the old Prisma client
  in memory ("Unknown field … on model SystemStatus").
- On Windows, `prisma generate` fails with EPERM while `next dev` holds the query-engine DLL —
  stop the dev server first.
- **All mail, offices and roles (2026-10-20, user request):**
  - Worker reads the WHOLE mailbox (inbox, archived, every label; no spam/trash/sent/drafts) —
    `GMAIL_LABELS` is gone. Every message stores `raw_messages.labels` (display names, noise like
    UNREAD/CATEGORY_* dropped) and `office` = its first label under `OFFICE_LABEL_PARENTS`
    (null for inbox-only mail). `system_status.syncedLabel = "*"` once the whole mailbox is
    synced; anything else forces one 24h backfill. Labels added AFTER a message was stored are
    not picked up (history reads messageAdded only).
  - Speed (2026-10-21, user report "very slow"): each run fetches the NEWEST unknown messages
    first (older backlog follows), so current alarms never wait behind a backfill. The Gmail
    project allows only ~110 messages.get per minute ("Units per minute per user"), so the
    per-run cap adapts (`nextFetchCap`: just under what Gmail allowed on a quota hit, +10% per
    clean full run, halved when listing itself hits the quota, ≥ 20, ≤ MAX_MESSAGES_PER_RUN).
    A quota hit is a pause, not an error (lastError stays null).
  - Office of an alarm (`alarms.office`, what every page filters on) = the Site Master office of
    `siteCode` (= siteCodeOf(site)), mapped to the Gmail office label by `officeMatchKey`
    ("KAFR EL DAWAR" ↔ "DN/Kafr ElDawar": last "/" segment, letters only, upper-case); when the
    code is not in Site Master (or its office matches no label) → `mailOffice` (the mail label).
    Kept by `@alarm/db resolveOffices()`: worker after each batch (new rows) and after reprocess,
    Site Master import/edit (whole table), office label list change. Orphan clears the same way.
    Import response lists `unmappedOffices` (Site Master names without a label).
  - **HOTLINE role (2026-10-29, user request):** VIEWER < OPERATOR < ADMIN < HOTLINE <
    SUPER_ADMIN (migration `20261029000000_hotline_role`). Has the super admin's powers — every
    office + office view (`seesAllOffices()` in roles.ts, used by scopeOfficeOf, the /alarms and
    hourly Office filters, Site Master manage scope), reprocess (`@Roles("HOTLINE")` on
    PUT settings/office + POST reprocess), hourly processing, its own WhatsApp sender — but NOT
    the settings for everyone: classification rules, hidden-for-everyone types, Gmail, value
    normalization (all SUPER_ADMIN by rank), hourly settings (`hourlyEditKey` → null) and Users &
    roles (`@NoHotline()` guard marker, 403 "Not available to hotline accounts"). Display alarms
    = its own personal hidden types only. Only the super admin creates hotline accounts (no
    office, like the super admin). No Send panel (that stays ADMIN / OPERATOR). **Pages:** only
    Alarms, Cleared, Dashboard and Settings (user request) — `apps/web/lib/pages.ts`
    `canSeePage()` filters the sidebar and `components/page-gate.tsx` (wraps every (app) page in
    the layout) sends /hourly… and /site-master back to /alarms. The APIs behind them are not
    blocked.
    `apps/api/src/test/hotline.integration.test.ts`.
  - Roles: VIEWER < OPERATOR < ADMIN (office admin) < SUPER_ADMIN. `users.office` = the office a
    viewer/operator/admin belongs to (sees ONLY it; none = sees nothing); for the super admin it
    is the office being viewed (null = all offices, picked in /settings "Office view").
    Office admin: /settings shows only Users — list/create/delete/reset viewers + operators of
    their own office (404 for others). Super admin: everything (Gmail, rules, display filter,
    reprocess, Site Master, normalizations, all users/offices). Pure rules in
    `packages/core/src/roles.ts` (unit-tested). The API auth guard and the (app) layout read role + office
    from the DB on every request, so changes apply at once and deleted accounts get 401.
  - Hourly reports + Site Master list are office-scoped too (rows whose Site Master office is the
    user's office; unknown codes hidden from office users).
  - Migration converts existing ADMIN accounts to SUPER_ADMIN and gives every account the
    previously selected `officeLabel`; seed creates ADMIN_EMAIL as SUPER_ADMIN. Office admins are
    created by the super admin in /settings → Users (role "office admin" + office).
  - Integration tests use real accounts from `apps/api/src/test/test-users.ts` (the guard reads the DB).
- Gmail access uses `@googleapis/gmail` + `google-auth-library` (same API as `googleapis`,
  far smaller — keeps the worker image < 200MB). Scope: gmail.readonly.
- Gmail account: de.alarms@mobi-egypt.com (Workspace). OAuth app is in Testing mode with this
  account as a test user. Testing-mode refresh tokens expire after 7 days → before Phase 8
  publish the app (or set User type = Internal) so the worker doesn't lose access weekly.
- samples/ is gitignored (real network data). 300 msgs = only ~40 min of mail; a second
  subject format exists ("Huawei Alram Notify New alarm: ...") — handle in Phase 2.
- **WhatsApp sender (2026-10-28, user request "Plan auto-sending" → "Yes, build it"):** new
  service `apps/whatsapp` (Baileys 7.0.0-rc14 — 6.7.x pulls libsignal from git; node:http on :4300,
  internal, `X-Internal-Token` = WHATSAPP_TOKEN || NEXTAUTH_SECRET; session in WHATSAPP_SESSION_DIR,
  default repo `data/whatsapp`, Docker volume `whatsapp`). Pure checks in `src/plan.ts` (chatRef,
  planSend: ≤ 30 PNGs of ≤ 5 MB, text ≤ 4000, text first) and 1.5 s between messages, one send at a
  time (`sender.ts`); a log-out wipes the session and shows a new QR; group links resolved once via
  groupGetInviteInfo. API `modules/whatsapp.controller.ts`: GET /api/whatsapp/status (everyone; QR
  super admin only; `canSend` = operator+), POST /logout (super admin), POST /send (operator+, chat
  must be one of the user's saved chats — `savedChats()` over uiPrefs sendChat / image.shareAll /
  shareOffices), GET /sends (super admin). Table `whatsapp_sends` (migration
  `20261028000000_whatsapp_sends`: who, chat, chatName, texts, images, ok, error). Web:
  /settings/whatsapp ("WhatsApp sender", Administration, super admin: QR polled every 3 s, status,
  Log out, last sends); `components/whatsapp.tsx` (`useWhatsAppSender`, `sendViaWhatsApp`). When
  linked: Export image "Send to N chats" posts every chat its images in one click (chips show
  sending / ✓ / ✗ error); the Send panel's Share posts the text to its saved chat. Not linked →
  the copy / paste flow. Verified: 3 plan tests, 4 API integration tests with a fake sender, and a
  live start that reached WhatsApp and produced a QR; no real phone linked yet. RUNBOOK section.
  **Per-user numbers (2026-10-29, user request):** every account except viewers links ITS OWN
  number. Service: `SenderPool` (`src/pool.ts`) — one `WhatsAppSender` per users.id in
  `<session root>/users/<id>`; every call carries `?user=` (digits only, else 400); boot starts
  the linked ones; an unlinked account starts (shows a QR) only on `/status?start=1` (the
  settings page) and stops when the QR expires; a log-out wipes that account's folder. The
  first version's single session (files in the root) is moved to the first SUPER_ADMIN whose
  status call has `adopt=1` (done: user 1, "work" +201279752435). API: status per user (viewers
  get "disconnected" without asking the service), logout + send + sends for OPERATOR+ on their
  own session (super admin's sends list = everyone's). Web: Settings → **WhatsApp sender** is in
  the Personal group for operator / admin / super admin; `useWhatsAppSender()` shares one
  status request per page (60 s cache, `resetWhatsAppStatus()` after link / log-out).
  **WhatsApp UI only while the user's number is linked:** the image windows' Send button and
  result chips (else just Download — the old copy / paste WhatsApp flow is gone from
  `ImageExportDialog`), the Share settings tab of both image settings windows, the floating
  Send panel button (also still ADMIN / OPERATOR only) and the Site Master "WhatsApp" button.
- **NestJS API (2026-10-21, user request: REST API for a React Native app, no behaviour change):**
  - `apps/api` serves every former Route Handler at the SAME path, method, status code and JSON
    shape (errors `{error, details?}` via `ErrorFilter`). Controllers in `src/modules/*`, the old
    `apps/web/lib` server code moved to `src/lib/*` unchanged; `src/common/http.ts` keeps the zod
    `parseQuery/parseBody` helpers. Nest's body parser is OFF: bodies are read per route
    (json / text / multipart via the Fetch API) so error messages stay identical.
  - Auth = global `AuthGuard` (`@Public()`, `@Roles(role)`, `@CurrentUser()`): Bearer JWT
    (`POST /api/auth/token` {email,password} → HS256, 30 days, `API_JWT_SECRET` or
    NEXTAUTH_SECRET) OR the NextAuth session cookie (decrypted like next-auth/jwt v4 with
    NEXTAUTH_SECRET). Role + office read from the DB on every request (deleted user → 401).
    New for mobile: `POST /api/auth/token`, `GET /api/me`. CORS open (no cookies with Bearer).
  - Web: `next.config.mjs` rewrites `/api/:path*` (fallback) and `/api/auth/token` (beforeFiles,
    else NextAuth's catch-all takes it) to `API_URL` (default http://127.0.0.1:4100; Docker build
    arg `http://api:4100`) — fixed at `next build`. NextAuth stays in Next. The API derives the
    page address from X-Forwarded-Host/-Proto (Gmail OAuth redirect URI, callback redirect).
  - Shared pure code moved to `@alarm/core` (`roles.ts`, `displayFilter.ts`) and DB reads to
    `@alarm/db` (`getDisplayFilter(prisma)`, `getUserDisplayFilter(prisma, id)`).
  - No emitDecoratorMetadata reliance (tsx/vitest use esbuild): no constructor DI by type,
    `@Inject(Reflector)` explicit. Nest 11 chosen over Nest 12 (12 is ESM-only, 2 months old).
  - Local dev: `apps/api/.env.local` (gitignored; DATABASE_URL + NEXTAUTH_SECRET like the web's)
    → `corepack pnpm --filter @alarm/api dev` (:4100), then the web dev server as before.
    `.claude/launch.json`: `api` + `web-via-api` (:3300). The Playwright e2e (`test:e2e`) needs
    the API: playwright.config.ts starts it (tsx, :4200, alarms_test, fixture mock dir).
  - Integration tests boot the real Nest app on a random port (`src/test/harness.ts`) and call it
    over HTTP with Bearer tokens; one test checks the NextAuth cookie path. 33 API tests pass.

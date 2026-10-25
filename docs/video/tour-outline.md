# Alarm Filter — video tour (outline)

Video: `docs/video/alarm-filter-tour.webm` (1440×900, Arabic captions with English UI terms).
The video and the generated mock reports show real network data (sites, phones) — they are
gitignored; share the video only inside the team.

Recorded headless by `apps/web/e2e/tour/tour.mjs` (Playwright `recordVideo`) against the dev DB,
with the `.claude/launch.json` servers `api-tour-mock` (:4110) + `web-via-api-mock` (:3310).
Re-record (from `apps/web`):

1. `node e2e/tour/make-fixtures.mjs` — builds `docs/video/.tour-fixtures/`: the real fixture
   report (`tests/fixtures/NSN Update_Output.rar`) plus an "hour earlier" `.xlsx` with rows
   removed/changed, so Compare has something to show.
2. Start `api-tour-mock` and `web-via-api-mock`, then `node e2e/tour/explore.mjs` once (compiles
   every route so `next dev` pauses stay short).
3. `node e2e/tour/tour.mjs` → raw recording + `cuts.json` (the slow page loads).
4. `node e2e/tour/cut.mjs` → removes the loads (replays the raw video in headless Chromium with
   MediaRecorder, then remuxes with Playwright's ffmpeg). Keep the PC awake: it runs in real time.
5. `node e2e/tour/frames.mjs <dir> 10 60 …` → stills for a quick check.

The script signs in with `DEV_TEST_EMAIL` / `DEV_TEST_PASSWORD` from `apps/web/.env.local`,
switches that account's office view to "all offices" for the tour (the hourly fixture rows are
Kafr El Dawar) and restores the office and UI prefs at the end. Downloads (Excel / PDF) and
clipboard copies happen inside the headless browser only.

| # | Scene | What is shown |
|---|---|---|
| 1 | مقدمة / Intro | What the app does: reads alarm mails from Gmail, classifies Down/Power/Other, matches Clears |
| 2 | Login | Email + password, Sign in |
| 3 | Sidebar | Alarms, Cleared, Dashboard, Hourly Alarms, Settings |
| 4 | Active alarms | Count, table columns, live Age, rows > 4 h highlighted, Site Master columns (VIP, Nodality, Battery, Phone) |
| 5 | Filters | Category (DOWN), Site, Region, Older than; filters live in the URL; Refresh; Export (.xlsx download) |
| 6 | Cleared alarms | From/To date range, Duration, Clear type (EMAIL / AUTO_SUPERSEDED), paging, Export |
| 7 | Dashboard | Counters per category / > 4 h / cleared 24 h (links), 30-day chart, Top 10 sites, MTTR, last-sync status |
| 8 | Notifications bell | Unread badge, popup list, Mark all read, link to notification settings |
| 9 | Hourly Alarms | Report list (time, sender, file, size), stateless 30-min cache, Process, Open |
| 10 | Hourly report | Sheet tabs, tab switching, filters (Office, Alarm, Region, Site type, Category, VIP, time, search), Clear filters, office colours + age colours, Site # column, row/site counter |
| 11 | Hourly outputs | Columns chooser, Copy as table, Image for WhatsApp dialog, PDF download, Export Excel |
| 12 | Compare | Compare with previous → new / disappeared rows |
| 13 | Settings · General | Section sidebar by role; theme Blue / Dark / Light (switched live) |
| 14 | Settings · Notifications | On/off, sound, categories, alarm names, sites |
| 15 | Settings · Display alarms | Hidden columns, icons; "One row per site code" turned on → grouped /alarms → turned off; personal hidden types |
| 16 | Settings · Classification | Pattern → category rules, priority order, Add rule / Save rules |
| 17 | Settings · Hourly reports | Hidden sheets/categories/names, column order for table/Excel/PDF and images, sort by site code, age colours, split |
| 18 | Settings · Users & roles | Add user, role + office, Reset password, Delete; viewer < operator < office admin < super admin |
| 19 | Settings · Office view | Super admin picks an office or All offices |
| 20 | Settings · Reprocess | Rebuild alarms for N days (Queue reprocess) |
| 21 | Settings · Gmail connection | Status, Test connection, Reconnect, Upload credentials.json |
| 22 | Settings · Site Master | Import xlsx, site table (phone editable), normalization rules |
| 23 | Outro | Sign out |

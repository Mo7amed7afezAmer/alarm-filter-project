# P0-T02: alarm filter web app — hourly reports, NestJS API, settings, alarms redesign

## What
Everything on `feat/P0-T02` since `main`:

- **Hourly reports** (Nokia RAR / XLSX): stateless pipeline, /hourly UI, compare view, WhatsApp images, PDF / Excel output settings.
- **Site Master**: import (network DB layout), phone / location, joined to alarms; `/site-master` page with a Details window (edit, delete, copy, WhatsApp).
- **All-mail sync** with office scoping via Site Master, and super / office admin roles.
- **REST API moved to NestJS** (`apps/api`), same paths and JSON; Bearer tokens for the mobile app.
- **Settings** for every user (section sidebar, themes, alarm table prefs); dark navy theme + left sidebar.
- **Alarm Mail view** with alarm / clear mail links (migrations `20261024000000_alarm_mail_links`, `20261024010000_site_location`).
- **Alarms redesign** (latest commit): category tabs with counts; search, site-tag filter (VIP / Nodal / Generator) and an office filter for a super admin viewing all offices; Table / Mail switch and mail-card parts moved to Settings → Display alarms (default = mail view with tags, labels, age, cell / device, call button); text-only site tags VIP · NODAL · BATT · GEN; no office chip; smaller corners.

## Why
User requests during Phases 7 and 12 (see `CLAUDE.md` §12 for the dated decisions).

## Reviewer notes
- **Generator rule:** a power source of another operator (`VF` / `ET` / `WE`, also glued like `ETDG`, `DGVF`) is not a generator — tags, the alarm filter and the Site Master filter all use `hasGenerator()`.
- `GET /api/alarms/active` now also returns `categories` (counts per category with the other filters) and `offices` (super admin viewing all offices only).
- `uiPrefs.alarms.mail` is new and the default view is now `mail`; stored prefs keep their saved view.
- Two new migrations — run `docker compose run --rm migrate` before starting.
- Tests: core unit tests (180) and API integration tests on `alarms_test` (`--no-file-parallelism`) pass, including a new test for search / tags / tab counts / office filter.
- The tour video and its fixtures stay gitignored (real network data).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

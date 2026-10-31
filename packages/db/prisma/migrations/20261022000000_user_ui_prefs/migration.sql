-- Personal UI settings (theme, alarm table columns / grouping). Additive only.
ALTER TABLE "users" ADD COLUMN "uiPrefs" JSONB;

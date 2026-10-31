-- Hourly report settings shared per office ("*" = default for offices without their own).
CREATE TABLE "hourly_settings" (
    "key" TEXT NOT NULL,
    "prefs" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" INTEGER,

    CONSTRAINT "hourly_settings_pkey" PRIMARY KEY ("key")
);

-- The default starts as the super admin's personal hourly settings (they set them up so far).
INSERT INTO "hourly_settings" ("key", "prefs", "updatedAt", "updatedBy")
SELECT '*', "uiPrefs"->'hourly', CURRENT_TIMESTAMP, "id"
FROM "users"
WHERE "role" = 'SUPER_ADMIN' AND "uiPrefs" ? 'hourly'
ORDER BY "id"
LIMIT 1;

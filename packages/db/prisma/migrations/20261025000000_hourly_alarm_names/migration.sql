-- Alarm names seen in processed hourly reports (hide lists in Settings → Hourly reports).
CREATE TABLE "hourly_alarm_names" (
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_alarm_names_pkey" PRIMARY KEY ("name")
);

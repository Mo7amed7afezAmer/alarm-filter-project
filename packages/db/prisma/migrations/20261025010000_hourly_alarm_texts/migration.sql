-- Alarm Text values seen with each hourly alarm name (the settings search matches them).
ALTER TABLE "hourly_alarm_names" ADD COLUMN "alarmTexts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

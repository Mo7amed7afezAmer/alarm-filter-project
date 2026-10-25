-- Link each alarm to its alarm mail and (EMAIL clears) its Clear mail: arrival time + Gmail labels.
ALTER TABLE "alarms" ADD COLUMN "rawMessageId" INTEGER, ADD COLUMN "clearMessageId" INTEGER;

ALTER TABLE "alarms" ADD CONSTRAINT "alarms_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "raw_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_clearMessageId_fkey" FOREIGN KEY ("clearMessageId") REFERENCES "raw_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing alarms by CONSEC_NBR (the alarm and its Clear carry the same number).
-- Body-less alarms stay unlinked until the next reprocess.
WITH m AS (
  SELECT id, upper(subject) LIKE 'CLEARED\_%' AS is_clear,
         substring(body from 'CONSEC_NBR:\s*(\d+)') AS consec, "receivedAt"
  FROM "raw_messages"
  WHERE body IS NOT NULL
)
UPDATE "alarms" a SET "rawMessageId" = x.id
FROM (SELECT DISTINCT ON (consec) id, consec FROM m WHERE NOT is_clear AND consec IS NOT NULL
      ORDER BY consec, "receivedAt", id) x
WHERE a."consecNbr" = x.consec;

WITH m AS (
  SELECT id, upper(subject) LIKE 'CLEARED\_%' AS is_clear,
         substring(body from 'CONSEC_NBR:\s*(\d+)') AS consec, "receivedAt"
  FROM "raw_messages"
  WHERE body IS NOT NULL
)
UPDATE "alarms" a SET "clearMessageId" = x.id
FROM (SELECT DISTINCT ON (consec) id, consec FROM m WHERE is_clear AND consec IS NOT NULL
      ORDER BY consec, "receivedAt", id) x
WHERE a."consecNbr" = x.consec AND a."clearType" = 'EMAIL';

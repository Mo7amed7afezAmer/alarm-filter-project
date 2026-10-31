-- Log of WhatsApp sends made through the sender service (who, which chat, how many, result).
CREATE TABLE "whatsapp_sends" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT NOT NULL,
    "chat" TEXT NOT NULL,
    "chatName" TEXT,
    "texts" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_sends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_sends_createdAt_idx" ON "whatsapp_sends"("createdAt");

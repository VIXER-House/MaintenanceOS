-- Atomic de-duplication of inbound WhatsApp messages
CREATE TABLE "InboundReceipt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundReceipt_createdAt_idx" ON "InboundReceipt"("createdAt");

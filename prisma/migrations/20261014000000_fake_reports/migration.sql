-- Fake reports & blocked numbers
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FAKE_REPORTED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FAKE_CONFIRMED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'FAKE_DISMISSED';
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'UNIT_CONFIRMED';

CREATE TYPE "FakeReportStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

CREATE TABLE "FakeReport" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "residentId" TEXT,
    "reporterType" "ActorType" NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FakeReportStatus" NOT NULL DEFAULT 'PENDING',
    "ticketCancelled" BOOLEAN NOT NULL DEFAULT false,
    "previousStatus" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FakeReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FakeReport_phone_idx" ON "FakeReport"("phone");
CREATE INDEX "FakeReport_status_createdAt_idx" ON "FakeReport"("status", "createdAt");
CREATE INDEX "FakeReport_ticketId_idx" ON "FakeReport"("ticketId");
ALTER TABLE "FakeReport" ADD CONSTRAINT "FakeReport_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BlockedPhone" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedByName" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastNoticeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedPhone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BlockedPhone_phone_key" ON "BlockedPhone"("phone");

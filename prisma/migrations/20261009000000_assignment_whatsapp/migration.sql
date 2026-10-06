-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'DECLINED';
ALTER TYPE "TicketEventType" ADD VALUE 'REMINDER_SENT';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "declinedTechnicianIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "assignReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN "toPhone" TEXT;

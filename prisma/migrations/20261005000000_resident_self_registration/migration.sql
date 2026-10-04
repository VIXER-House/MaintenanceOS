-- AlterEnum
ALTER TYPE "ConversationState" ADD VALUE 'AWAITING_REGISTRATION';

-- DropForeignKey
ALTER TABLE "Resident" DROP CONSTRAINT "Resident_unitId_fkey";

-- AlterTable
ALTER TABLE "Resident" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "unitId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


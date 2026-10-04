/**
 * pnpm db:seed — loads the demo dataset (see src/server/seed/demo-seed.ts).
 * SEED_IF_EMPTY=1 keeps existing data (used on hosted deploys).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedDemo } from "../src/server/seed/demo-seed";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/maintenanceos" }),
});

seedDemo(db)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

import { createHash, randomUUID } from "crypto";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { Client } from "pg";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { seedDemo } from "@/server/seed/demo-seed";

/**
 * First-run bootstrap for hosted demos (e.g. Vercel + Neon), where the build step
 * may not reach the same database the app runs against.
 *
 * 1. If the schema is missing, applies prisma/migrations/*.sql and records them in
 *    `_prisma_migrations` exactly like `prisma migrate deploy`, so later deploys stay
 *    in sync.
 * 2. If there are no users, loads the demo dataset.
 *
 * Runs at most once per server instance; cheap no-op afterwards.
 * Set DISABLE_AUTO_BOOTSTRAP=1 to turn it off (recommended for real production).
 */
let ready: Promise<void> | null = null;

export function ensureDatabaseReady(): Promise<void> {
  if (process.env.DISABLE_AUTO_BOOTSTRAP === "1") return Promise.resolve();
  if (!ready) {
    ready = bootstrap().catch((e) => {
      ready = null; // retry on next request
      throw e;
    });
  }
  return ready;
}

async function bootstrap() {
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || getConfig().DATABASE_URL });
  await client.connect();
  try {
    // Serialize concurrent cold starts
    await client.query("SELECT pg_advisory_lock(727274)");
    const { rows } = await client.query(`SELECT to_regclass('public."User"') AS t`);
    if (!rows[0]?.t) {
      console.info("[bootstrap] schema missing — applying migrations");
      await applyMigrations(client);
    }
    const users = await client.query(`SELECT count(*)::int AS n FROM "User"`);
    if (users.rows[0].n === 0) {
      console.info("[bootstrap] database empty — loading demo data");
      await seedDemo(db);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => null);
    await client.end().catch(() => null);
  }
}

async function applyMigrations(client: Client) {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  for (const name of names) {
    const done = await client.query(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`, [name]);
    if (done.rowCount) continue;
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`,
        [randomUUID(), createHash("sha256").update(sql).digest("hex"), name],
      );
      await client.query("COMMIT");
      console.info(`[bootstrap] applied ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
}

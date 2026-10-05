import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { requireBridge } from "@/server/http/bridge-auth";

export const maxDuration = 60;

/**
 * WhatsApp login keys for the cloud bridge. Kept in the app database so the bridge
 * can run on a host with no persistent disk and survive restarts without re-scanning.
 */
export const GET = route(async (req) => {
  requireBridge(req);
  const rows = await db.whatsAppAuthKey.findMany({ select: { key: true, value: true } });
  return { entries: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
});

const Body = z.union([
  z.object({ clear: z.literal(true) }),
  z.object({ set: z.record(z.string().min(1).max(300), z.string().max(200_000).nullable()) }),
]);

export const POST = route(async (req) => {
  requireBridge(req);
  const body = await parseBody(req, Body);
  if ("clear" in body) {
    await db.$transaction([
      db.whatsAppAuthKey.deleteMany({}),
      db.whatsAppBridgeSession.upsert({
        where: { id: "default" },
        update: { logoutRequested: false, phone: null, qr: null, status: "logged_out" },
        create: { id: "default", status: "logged_out" },
      }),
    ]);
    return { ok: true };
  }
  const entries = Object.entries(body.set);
  const removed = entries.filter(([, v]) => v === null).map(([k]) => k);
  const upserts = entries.filter(([, v]) => v !== null) as [string, string][];
  if (removed.length) await db.whatsAppAuthKey.deleteMany({ where: { key: { in: removed } } });
  // One bulk upsert per chunk — a fresh login writes hundreds of keys at once
  for (let i = 0; i < upserts.length; i += 500) {
    const chunk = upserts.slice(i, i + 500);
    const keys = chunk.map(([k]) => k);
    const values = chunk.map(([, v]) => v);
    await db.$executeRaw`
      INSERT INTO "whatsapp_auth" ("key", "value", "updatedAt")
      SELECT k, v, now() FROM unnest(${keys}::text[], ${values}::text[]) AS t(k, v)
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
  }
  return { ok: true, written: upserts.length, removed: removed.length };
});

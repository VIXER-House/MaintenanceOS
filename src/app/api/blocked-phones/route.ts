import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { blockPhone, unblockPhone } from "@/server/services/fake-report.service";

/** Block (POST { phone, reason }) / unblock (DELETE { phone }) a WhatsApp number. */
export const POST = route(async (req) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, z.object({ phone: z.string().trim().min(6).max(30), reason: z.string().trim().max(500).optional().default("") }));
  const row = await blockPhone(body.phone, body.reason, actor);
  return { ok: true, id: row.id, phone: row.phone };
});

export const DELETE = route(async (req) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, z.object({ phone: z.string().trim().min(6).max(30) }));
  return unblockPhone(body.phone, actor);
});

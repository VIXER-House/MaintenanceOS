import { requireApiUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/server/http/api";
import { AppError, NotFoundError } from "@/server/services/errors";

/** Manager confirms a resident who self-registered on WhatsApp (human-in-the-loop). */
export const POST = route(async (_req, { id }) => {
  await requireApiUser(MANAGERS);
  const r = await db.resident.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Resident");
  if (!r.unitId) throw new AppError("Resident has not provided a unit yet");
  await db.resident.update({ where: { id }, data: { verified: true } });
  return { ok: true };
});

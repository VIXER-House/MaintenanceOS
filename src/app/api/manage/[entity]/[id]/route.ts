import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { NotFoundError } from "@/server/services/errors";
import { deleteRecord, isEntity, resetPassword, setActive, updateRecord } from "@/server/services/manage.service";

export const PATCH = route(async (req, { entity, id }) => {
  const { actor } = await requireApiUser(MANAGERS);
  if (!isEntity(entity)) throw new NotFoundError("Entity");
  return { record: await updateRecord(entity, id, await parseBody(req, z.unknown()), actor) };
});

/** Hard delete — refused (409 IN_USE, details.canArchive) when the record has history. */
export const DELETE = route(async (_req, { entity, id }) => {
  const { actor } = await requireApiUser(MANAGERS);
  if (!isEntity(entity)) throw new NotFoundError("Entity");
  await deleteRecord(entity, id, actor);
  return { ok: true };
});

const Action = z.object({ action: z.enum(["archive", "restore", "resetPassword"]) });

/** archive / restore / resetPassword */
export const POST = route(async (req, { entity, id }) => {
  const { actor } = await requireApiUser(MANAGERS);
  if (!isEntity(entity)) throw new NotFoundError("Entity");
  const { action } = await parseBody(req, Action);
  if (action === "resetPassword") return { credentials: await resetPassword(entity, id, actor) };
  return { record: await setActive(entity, id, action === "restore", actor) };
});

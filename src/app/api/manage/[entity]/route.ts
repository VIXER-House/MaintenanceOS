import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { NotFoundError } from "@/server/services/errors";
import { createRecord, isEntity } from "@/server/services/manage.service";
import { z } from "zod";

/** Create a record (residents, units, buildings, technicians, contractors, assets, categories, teams, users). */
export const POST = route(async (req, { entity }) => {
  const { actor } = await requireApiUser(MANAGERS);
  if (!isEntity(entity)) throw new NotFoundError("Entity");
  return { record: await createRecord(entity, await parseBody(req, z.unknown()), actor) };
});

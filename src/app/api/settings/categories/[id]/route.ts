import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { updateRecord } from "@/server/services/manage.service";

/** Managers edit a category: names, description, keywords, default priority, SLA, skill, quotation threshold and keyword rules. */
export const PATCH = route(async (req, { id }) => {
  const { actor } = await requireApiUser(MANAGERS);
  return { category: await updateRecord("categories", id, await parseBody(req, z.unknown()), actor) };
});

import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { CategoryUpdateSchema, updateCategory } from "@/server/services/settings.service";

/** Managers edit a category: names, default priority, SLA, skill, quotation threshold and keyword rules. */
export const PATCH = route(async (req, { id }) => {
  await requireApiUser(MANAGERS);
  return { category: await updateCategory(id, await parseBody(req, CategoryUpdateSchema)) };
});

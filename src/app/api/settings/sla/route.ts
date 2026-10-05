import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { SlaUpdateSchema, updateSlaPolicies } from "@/server/services/settings.service";

/** Managers edit SLA response / resolution targets per priority. */
export const PUT = route(async (req) => {
  await requireApiUser(MANAGERS);
  return { policies: await updateSlaPolicies(await parseBody(req, SlaUpdateSchema)) };
});

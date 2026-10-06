import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { SlaUpdateSchema, updateSlaPolicies } from "@/server/services/settings.service";
import { recordAudit } from "@/server/services/manage.service";

/** Managers edit SLA response / resolution targets per priority. */
export const PUT = route(async (req) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, SlaUpdateSchema);
  const policies = await updateSlaPolicies(body);
  await recordAudit(actor, "sla", null, "update", `Updated SLA targets (${body.policies.map((p) => p.priority).join(", ")})`, body.policies);
  return { policies };
});

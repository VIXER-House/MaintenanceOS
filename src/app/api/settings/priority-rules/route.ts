import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { PriorityRulesSchema, saveGlobalPriorityRules } from "@/server/services/settings.service";
import { recordAudit } from "@/server/services/manage.service";

const Body = z.union([z.object({ reset: z.literal(true) }), z.object({ rules: PriorityRulesSchema })]);

/** Managers edit the global safety rules (or reset them to the built-in defaults). */
export const PUT = route(async (req) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, Body);
  const rules = await saveGlobalPriorityRules("reset" in body ? null : body.rules, actor);
  await recordAudit(actor, "priorityRules", null, "reset" in body ? "reset" : "update", "reset" in body ? "Reset global safety rules to defaults" : `Updated global safety rules (${rules.length})`);
  return { rules };
});

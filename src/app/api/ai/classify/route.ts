import { z } from "zod";
import { requireApiUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { classifyRequest } from "@/server/services/ai.service";
import { evaluatePriority } from "@/server/engines/priority/priority-engine";
import { computeTicketSla } from "@/server/services/sla.service";
import type { PriorityRule } from "@/server/domain/categories";
import type { Priority } from "@/server/domain/constants";

const Body = z.object({ text: z.string().trim().min(1).max(2000) });

/** Dry-run: AI classification + rules-validated priority + SLA, without creating a ticket. */
export const POST = route(async (req) => {
  await requireApiUser(MANAGERS);
  const { text } = await parseBody(req, Body);
  const outcome = await classifyRequest({ text });
  const category = await db.category.findUnique({ where: { key: outcome.classification.category } });
  const decision = evaluatePriority({
    text,
    categoryDefault: (category?.defaultPriority as Priority) ?? "MEDIUM",
    categoryRules: (category?.priorityRules as unknown as PriorityRule[]) ?? [],
    aiPriority: outcome.classification.priority,
  });
  const sla = await computeTicketSla(decision.priority, new Date(), category?.defaultResolutionMinutes);
  return { ...outcome, priorityDecision: decision, sla: { responseMinutes: sla.responseMinutes, resolutionMinutes: sla.resolutionMinutes } };
});

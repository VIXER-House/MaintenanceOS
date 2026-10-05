import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { PRIORITIES, type Priority } from "@/server/domain/constants";
import type { PriorityRule } from "@/server/domain/categories";
import { GLOBAL_PRIORITY_RULES } from "@/server/engines/priority/rules";
import type { Actor } from "./actor";
import { AppError } from "./errors";

/** Manager-editable configuration: SLA policies, categories and priority rules. */

export const PriorityRuleSchema = z.object({
  priority: z.enum(PRIORITIES),
  reason: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
});
export const PriorityRulesSchema = z.array(PriorityRuleSchema).max(50);

const GLOBAL_RULES_KEY = "globalPriorityRules";
const CACHE_MS = 30_000;
let cache: { rules: PriorityRule[]; at: number } | null = null;

/** Global safety rules (floor for every category). Defaults to the built-in list until a manager edits them. */
export async function getGlobalPriorityRules(): Promise<PriorityRule[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  let rules = GLOBAL_PRIORITY_RULES;
  try {
    const row = await db.appSetting.findUnique({ where: { key: GLOBAL_RULES_KEY } });
    const parsed = row ? PriorityRulesSchema.safeParse(row.value) : null;
    if (parsed?.success) rules = parsed.data;
  } catch {
    /* table missing (old DB) → built-in defaults */
  }
  cache = { rules, at: Date.now() };
  return rules;
}

export async function saveGlobalPriorityRules(rules: PriorityRule[] | null, actor: Actor) {
  if (rules === null) {
    await db.appSetting.deleteMany({ where: { key: GLOBAL_RULES_KEY } });
  } else {
    const value = PriorityRulesSchema.parse(rules) as unknown as Prisma.InputJsonValue;
    await db.appSetting.upsert({
      where: { key: GLOBAL_RULES_KEY },
      update: { value, updatedBy: actor.name },
      create: { key: GLOBAL_RULES_KEY, value, updatedBy: actor.name },
    });
  }
  cache = null;
  return getGlobalPriorityRules();
}

export const SlaUpdateSchema = z.object({
  policies: z
    .array(
      z.object({
        priority: z.enum(PRIORITIES),
        responseMinutes: z.number().int().min(1).max(60 * 24 * 30),
        resolutionMinutes: z.number().int().min(1).max(60 * 24 * 90),
      }),
    )
    .min(1)
    .max(5),
});

/** New SLA targets apply to tickets created (or re-prioritised) from now on. */
export async function updateSlaPolicies(input: z.infer<typeof SlaUpdateSchema>) {
  for (const p of input.policies) {
    if (p.responseMinutes > p.resolutionMinutes) throw new AppError(`${p.priority}: response time cannot be longer than resolution time`, 400, "VALIDATION_ERROR");
  }
  await db.$transaction(
    input.policies.map((p) =>
      db.slaPolicy.upsert({
        where: { priority: p.priority as Priority },
        update: { responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes },
        create: { priority: p.priority as Priority, responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes },
      }),
    ),
  );
  return db.slaPolicy.findMany();
}

export const CategoryUpdateSchema = z.object({
  nameEn: z.string().trim().min(1).max(60),
  nameAr: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300),
  defaultPriority: z.enum(PRIORITIES),
  defaultResolutionMinutes: z.number().int().min(15).max(60 * 24 * 90),
  requiredSkill: z.string().trim().min(1).max(40),
  quotationThreshold: z.number().min(0).max(10_000_000),
  priorityRules: PriorityRulesSchema,
});

export async function updateCategory(id: string, input: z.infer<typeof CategoryUpdateSchema>) {
  return db.category.update({
    where: { id },
    data: { ...input, priorityRules: input.priorityRules as unknown as Prisma.InputJsonValue },
  });
}

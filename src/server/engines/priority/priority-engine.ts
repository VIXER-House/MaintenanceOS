import { findKeywords } from "@/lib/arabic";
import {
  PRIORITY_RANK,
  isPriority,
  priorityFromRank,
  type Priority,
} from "@/server/domain/constants";
import type { PriorityRule } from "@/server/domain/categories";
import { GLOBAL_PRIORITY_RULES } from "./rules";

export interface PriorityInput {
  /** Full request text (original message + follow-up answers + transcripts) */
  text: string;
  categoryDefault?: Priority | null;
  categoryRules?: PriorityRule[];
  globalRules?: PriorityRule[];
  /** What the AI suggested — treated as advice, never as truth */
  aiPriority?: string | null;
  aiConfidence?: number | null;
}

export interface RuleMatch {
  priority: Priority;
  reason: string;
  keywords: string[];
  scope: "GLOBAL" | "CATEGORY";
}

export type PrioritySource = "RULE" | "AI" | "AI_CAPPED" | "CATEGORY_DEFAULT" | "RULE_FLOOR";

export interface PriorityDecision {
  priority: Priority;
  aiPriority: Priority | null;
  rulePriority: Priority | null;
  source: PrioritySource;
  matches: RuleMatch[];
  reasons: string[];
}

function evaluateRules(text: string, rules: PriorityRule[], scope: RuleMatch["scope"]): RuleMatch[] {
  const out: RuleMatch[] = [];
  for (const rule of rules) {
    const hits = findKeywords(text, rule.keywords);
    if (hits.length) out.push({ priority: rule.priority, reason: rule.reason, keywords: hits, scope });
  }
  return out;
}

/**
 * Priority engine.
 *
 * 1. Global safety rules (emergency/critical/high keywords) → hard FLOOR.
 * 2. Category rules (configurable per category, can also LOWER, e.g. "light bulb" → LOW).
 * 3. Category default when no rule matches.
 * 4. AI suggestion is arbitrated:
 *    - may escalate at most ONE level above the rule/default baseline;
 *    - may never reach EMERGENCY without rule evidence;
 *    - may never go below a global safety floor;
 *    - may de-escalate at most one level below a category default (not below a rule).
 */
export function evaluatePriority(input: PriorityInput): PriorityDecision {
  const reasons: string[] = [];
  const globalMatches = evaluateRules(input.text, input.globalRules ?? GLOBAL_PRIORITY_RULES, "GLOBAL");
  const categoryMatches = evaluateRules(input.text, input.categoryRules ?? [], "CATEGORY");
  const matches = [...globalMatches, ...categoryMatches];

  const top = (ms: RuleMatch[]): Priority | null =>
    ms.length ? priorityFromRank(Math.max(...ms.map((m) => PRIORITY_RANK[m.priority]))) : null;

  const globalFloor = top(globalMatches);
  const categoryRule = top(categoryMatches);
  const rulePriority = top(matches);

  const aiPriority = isPriority(input.aiPriority) ? input.aiPriority : null;
  if (input.aiPriority && !aiPriority) reasons.push(`Ignored invalid AI priority "${input.aiPriority}"`);

  let baseline: Priority;
  let source: PrioritySource;
  if (rulePriority) {
    baseline = rulePriority;
    source = "RULE";
    const strongest = matches.find((m) => m.priority === rulePriority)!;
    reasons.push(`Rule: ${strongest.reason} (${strongest.keywords.join(", ")}) → ${rulePriority}`);
  } else {
    baseline = input.categoryDefault ?? "MEDIUM";
    source = "CATEGORY_DEFAULT";
    reasons.push(`No rule matched; category default → ${baseline}`);
  }

  let final = baseline;
  if (aiPriority && aiPriority !== baseline) {
    const aiRank = PRIORITY_RANK[aiPriority];
    const baseRank = PRIORITY_RANK[baseline];
    if (aiRank > baseRank) {
      let capped = Math.min(aiRank, baseRank + 1);
      if (capped === PRIORITY_RANK.EMERGENCY && globalFloor !== "EMERGENCY" && categoryRule !== "EMERGENCY") {
        capped = PRIORITY_RANK.CRITICAL;
      }
      final = priorityFromRank(Math.max(capped, baseRank));
      source = final === aiPriority ? "AI" : "AI_CAPPED";
      reasons.push(
        final === aiPriority
          ? `AI escalated ${baseline} → ${final}`
          : `AI suggested ${aiPriority}; escalation capped at ${final} (no rule evidence)`,
      );
    } else {
      if (rulePriority) {
        source = "RULE_FLOOR";
        reasons.push(`AI suggested ${aiPriority}; kept ${baseline} because a business rule applies`);
      } else {
        final = priorityFromRank(Math.max(aiRank, baseRank - 1));
        source = "AI";
        reasons.push(`AI de-escalated category default ${baseline} → ${final}`);
      }
    }
  }

  // Absolute safety floor from global rules
  if (globalFloor && PRIORITY_RANK[globalFloor] > PRIORITY_RANK[final]) {
    reasons.push(`Safety floor applied → ${globalFloor}`);
    final = globalFloor;
    source = "RULE_FLOOR";
  }

  return { priority: final, aiPriority, rulePriority, source, matches, reasons };
}

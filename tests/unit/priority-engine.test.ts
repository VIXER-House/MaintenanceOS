import { describe, expect, it } from "vitest";
import { evaluatePriority } from "@/server/engines/priority/priority-engine";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import type { Priority } from "@/server/domain/constants";

const evalFor = (text: string, category: string, aiPriority?: Priority | string | null) =>
  evaluatePriority({
    text,
    categoryDefault: CATEGORY_BY_KEY[category].defaultPriority,
    categoryRules: CATEGORY_BY_KEY[category].priorityRules,
    aiPriority,
  });

describe("priority engine — Egyptian Arabic business rules", () => {
  it.each([
    ["فيه ماسورة مياه انفجرت", "PLUMBING", "EMERGENCY"],
    ["الكهربا قاطعة عن الشقة", "ELECTRICAL", "HIGH"],
    ["التكييف مش شغال", "HVAC", "MEDIUM"],
    ["عايز أغير لمبة", "ELECTRICAL", "LOW"],
    ["اللمبة في المدخل اتحرقت", "ELECTRICAL", "LOW"],
    ["الأسانسير واقف", "ELEVATOR", "CRITICAL"],
    ["فيه ناس محبوسين في الأسانسير", "ELEVATOR", "EMERGENCY"],
    ["المياه بتسرب من سقف الحمام", "PLUMBING", "HIGH"],
    ["الحنفية بتسرب", "PLUMBING", "HIGH"],
    ["الباب مش بيقفل", "CARPENTRY", "HIGH"],
    ["المياه ضعيفة", "PLUMBING", "MEDIUM"],
    ["السخان مش شغال", "APPLIANCES", "MEDIUM"],
    ["Burst pipe in the kitchen", "PLUMBING", "EMERGENCY"],
    ["ريحة غاز في المطبخ", "APPLIANCES", "EMERGENCY"],
  ])("%s → %s", (text, category, expected) => {
    expect(evalFor(text, category).priority).toBe(expected);
  });

  it("does not confuse 'إنارة' (lighting) with 'نار' (fire)", () => {
    expect(evalFor("الإنارة في الجنينة ضعيفة", "ELECTRICAL").priority).toBe("LOW");
  });

  it("escalates on resident follow-up severity ('المياه كتير')", () => {
    expect(evalFor("فيه تسريب مياه في المطبخ\nالمياه كتير", "PLUMBING").priority).toBe("EMERGENCY");
  });
});

describe("priority engine — AI arbitration (do not trust the LLM blindly)", () => {
  it("lets AI escalate at most one level above the baseline", () => {
    const d = evalFor("التكييف مش شغال", "HVAC", "CRITICAL");
    expect(d.priority).toBe("HIGH");
    expect(d.source).toBe("AI_CAPPED");
  });

  it("never lets AI reach EMERGENCY without rule evidence", () => {
    const d = evalFor("الأسانسير واقف", "ELEVATOR", "EMERGENCY");
    expect(d.priority).toBe("CRITICAL");
  });

  it("never lets AI go below a safety rule", () => {
    const d = evalFor("ماسورة انفجرت", "PLUMBING", "LOW");
    expect(d.priority).toBe("EMERGENCY");
  });

  it("allows AI to de-escalate a category default by one level when no rule applies", () => {
    const d = evalFor("صوت غريب في الشفاط", "HVAC", "LOW");
    expect(d.priority).toBe("LOW");
  });

  it("ignores invalid AI priorities", () => {
    const d = evalFor("التكييف مش شغال", "HVAC", "SUPER_URGENT");
    expect(d.priority).toBe("MEDIUM");
    expect(d.aiPriority).toBeNull();
    expect(d.reasons.join(" ")).toMatch(/invalid/i);
  });

  it("accepts AI escalation of exactly one level", () => {
    expect(evalFor("التكييف مش شغال والجو حر جدا", "HVAC", "HIGH").priority).toBe("HIGH");
  });
});

import { describe, expect, it } from "vitest";
import { AIParseError, extractJson, normalizeCategory, normalizeConfidence, normalizePriority, parseClassificationResponse } from "@/server/providers/ai/parser";

describe("AI classification parser", () => {
  it("parses clean JSON", () => {
    const c = parseClassificationResponse(
      JSON.stringify({ category: "HVAC", priority: "MEDIUM", confidence: 0.92, issue: "Cooling failure", location: "Bedroom", recommendedAction: "Send HVAC technician" }),
    );
    expect(c.category).toBe("HVAC");
    expect(c.priority).toBe("MEDIUM");
    expect(c.confidence).toBe(0.92);
    expect(c.title).toBe("Cooling failure – Bedroom");
  });

  it("extracts JSON from markdown fences and prose", () => {
    const raw = 'Sure! Here is the result:\n```json\n{"category":"plumbing","priority":"urgent","confidence":"88%","issue":"Water leakage"}\n```';
    const c = parseClassificationResponse(raw);
    expect(c.category).toBe("PLUMBING");
    expect(c.priority).toBe("HIGH");
    expect(c.confidence).toBeCloseTo(0.88);
  });

  it("normalizes Arabic labels and snake_case keys", () => {
    const c = parseClassificationResponse({ category: "سباكة", priority: "طارئ", confidence: 95, issue: "Burst pipe", needs_more_info: "true", follow_up_question: "فين بالظبط؟" });
    expect(c.category).toBe("PLUMBING");
    expect(c.priority).toBe("EMERGENCY");
    expect(c.confidence).toBe(0.95);
    expect(c.needsMoreInfo).toBe(true);
    expect(c.followUpQuestion).toBe("فين بالظبط؟");
  });

  it("drops needsMoreInfo when no question is provided", () => {
    const c = parseClassificationResponse({ category: "HVAC", issue: "x", needsMoreInfo: true });
    expect(c.needsMoreInfo).toBe(false);
  });

  it("falls back to OTHER / MEDIUM for unknown values", () => {
    expect(normalizeCategory("spaceship")).toBe("OTHER");
    expect(normalizePriority(42)).toBe("MEDIUM");
    expect(normalizeConfidence("abc")).toBe(0.5);
    expect(normalizeConfidence(150)).toBe(1);
  });

  it("throws AIParseError on garbage", () => {
    expect(() => extractJson("I cannot help with that")).toThrow(AIParseError);
    expect(() => parseClassificationResponse("{}")).toThrow(AIParseError);
  });
});

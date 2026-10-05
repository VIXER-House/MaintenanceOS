import { describe, expect, it } from "vitest";
import { isAffirmativeAnswer } from "@/server/domain/answers";

describe("follow-up answers", () => {
  it.each(["اه في فردين", "ايوه", "أيوة ابني جوه", "2", "yes, two people", "في واحد"])("'%s' confirms the question", (a) => expect(isAffirmativeAnswer(a)).toBe(true));
  it.each(["لا", "لأ مفيش حد", "محدش جوه", "no", "nobody", "طلعوا خلاص؟ لا"])("'%s' does not", (a) => expect(isAffirmativeAnswer(a)).toBe(false));
});

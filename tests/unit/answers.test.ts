import { describe, expect, it } from "vitest";
import { isAffirmativeAnswer } from "@/server/domain/answers";
import { wantsNewRequest } from "@/server/domain/answers";

describe("follow-up answers", () => {
  it.each(["اه في فردين", "ايوه", "أيوة ابني جوه", "2", "yes, two people", "في واحد"])("'%s' confirms the question", (a) => expect(isAffirmativeAnswer(a)).toBe(true));
  it.each(["لا", "لأ مفيش حد", "محدش جوه", "no", "nobody", "طلعوا خلاص؟ لا"])("'%s' does not", (a) => expect(isAffirmativeAnswer(a)).toBe(false));
});

describe("wantsNewRequest", () => {
  it.each(["عاوز اسجل شكوى تانية", "عايز اعمل طلب جديد", "عندي مشكلة تانية", "I want to file a new complaint", "another issue please"])("%s → true", (t) => expect(wantsNewRequest(t)).toBe(true));
  it.each(["شكرا", "لسه محدش جه", "الحالة ايه", "تمام"])("%s → false", (t) => expect(wantsNewRequest(t)).toBe(false));
});

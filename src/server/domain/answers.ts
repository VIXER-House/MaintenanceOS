import { matchKeyword, normalizeArabic } from "@/lib/arabic";

/** Words that answer a yes/no question positively — including "two people", "my son", … */
const AFFIRM = [
  "اه", "ايوه", "ايوة", "ايوا", "نعم", "اكيد", "طبعا", "فعلا", "صح", "مظبوط", "yes", "yeah", "yep", "sure", "correct",
  // people / quantities ("is anyone trapped?" → "two people")
  "حد", "فرد", "فردين", "افراد", "شخص", "شخصين", "اشخاص", "ناس", "واحد", "واحده", "اتنين", "تلاته", "تلات", "اربعه",
  "عيل", "عيال", "طفل", "اطفال", "ولد", "بنت", "ابني", "بنتي", "ست", "راجل", "جوزي", "مراتي", "امي", "ابويا", "جدي", "جدتي",
  "someone", "somebody", "people", "person", "persons", "one", "two", "three", "child", "kids",
];
/** Negative answers ("no", "nobody", "not anymore") */
const NEGATE = ["لا", "لأ", "مفيش", "محدش", "ماحدش", "ابدا", "no", "nope", "nobody", "none", "never"];

export function isNegativeAnswer(text: string): boolean {
  const n = normalizeArabic(text);
  return NEGATE.some((k) => matchKeyword(n, k));
}

/**
 * Did the resident confirm the follow-up question? ("is anyone trapped?" → "yes, two people").
 * A digit also counts ("2"). Negations win: "no, nobody" is not a confirmation.
 */
export function isAffirmativeAnswer(text: string): boolean {
  if (isNegativeAnswer(text)) return false;
  const n = normalizeArabic(text);
  return /\d/.test(text) || AFFIRM.some((k) => matchKeyword(n, k));
}

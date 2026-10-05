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

/** Phrases that say a message is about an additional / different problem. */
const DISTINCT = [
  "مشكله تانيه", "مشكله تاني", "مشكله تانيه كمان", "مشكله جديده", "مشكله مختلفه", "مشكله غير", "حاجه تانيه", "حاجه غير", "عطل تاني",
  "عطل جديد", "بالاضافه", "مختلفه", "مختلف", "تانيه خالص", "مش نفس", "غير دي", "غير ده",
  "another", "different", "new issue", "new problem", "additional", "second issue", "not the same",
];
/** Phrases that confirm it's the same problem already reported. */
const SAME = ["نفس المشكله", "نفسها", "نفس الحاجه", "هي هي", "هيا هيا", "نفس", "ايوه نفس", "same", "same issue", "same problem", "the same"];

/** "...and also the toilet is broken" — the message itself says this is another problem. */
export function mentionsDistinctIssue(text: string): boolean {
  const n = normalizeArabic(text);
  return DISTINCT.some((k) => matchKeyword(n, k));
}

/** Answer to "same problem or a different one?" → "different". "لا" (= not the same) counts. */
export function isDifferentIssueAnswer(text: string): boolean {
  return mentionsDistinctIssue(text) || (isNegativeAnswer(text) && !isSameIssueAnswer(text));
}

/** Answer to "same problem or a different one?" → "same". "اه / ايوه" (= yes, the same) counts. */
export function isSameIssueAnswer(text: string): boolean {
  const n = normalizeArabic(text);
  if (mentionsDistinctIssue(text)) return false;
  return SAME.some((k) => matchKeyword(n, k)) || (!isNegativeAnswer(text) && ["اه", "ايوه", "ايوة", "ايوا", "نعم", "صح", "yes", "yeah", "yep"].some((k) => matchKeyword(n, k)));
}

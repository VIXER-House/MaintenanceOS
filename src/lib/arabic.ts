/**
 * Arabic / Egyptian-Arabic text normalization used by the rules engine and the mock NLU.
 * Removes diacritics and tatweel, unifies alef/yaa/taa-marbuta variants, lowercases Latin.
 */
const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // Arabic-Indic digits → Latin
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsArabic(input: string): boolean {
  return /[؀-ۿ]/.test(input || "");
}

export function detectLanguage(input: string): "ar" | "en" {
  return containsArabic(input) ? "ar" : "en";
}

/** Common Arabic proclitics that get glued to words: و، ف، ب، ل، ال، … */
const PREFIXES = ["وبال", "فال", "بال", "وال", "لل", "ال", "و", "ف", "ب", "ل"];

function tokenVariants(token: string): string[] {
  const out = new Set<string>([token]);
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 2) out.add(token.slice(p.length));
  }
  return [...out];
}

/**
 * Keyword matcher that is robust to Arabic prefixes and avoids naive substring
 * false positives (e.g. "نار" (fire) must not match "انارة" (lighting)).
 * - Multi-word keywords: substring match on the normalized text.
 * - Single-word keywords: token match (with prefix stripping); keywords ≥ 4 chars
 *   also match as a token prefix to cover suffixes (بتسرب / بتسربت).
 */
export function matchKeyword(normalizedText: string, keyword: string): boolean {
  const kw = normalizeArabic(keyword);
  if (!kw) return false;
  if (kw.includes(" ")) return ` ${normalizedText} `.includes(` ${kw}`) || normalizedText.includes(kw);
  const tokens = normalizedText.split(" ");
  for (const t of tokens) {
    for (const v of tokenVariants(t)) {
      if (v === kw) return true;
      if (kw.length >= 4 && v.startsWith(kw)) return true;
    }
  }
  return false;
}

export function findKeywords(text: string, keywords: string[]): string[] {
  const n = normalizeArabic(text);
  return keywords.filter((k) => matchKeyword(n, k));
}

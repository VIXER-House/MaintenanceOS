/**
 * Unit codes as each compound writes them: "A01-101", "V-12", "B3/105", "Villa 12", "فيلا ١٢".
 * Matching ignores case, spaces and separators, and understands Arabic digits.
 */

const DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Arabic words residents use for common unit-code prefixes */
const WORDS: [RegExp, string][] = [
  [/(ڤيلا|فيلا|فيلة|ڤيلة)/g, "VILLA"],
  [/(شقة|شقه)/g, "APT"],
  [/(عمارة|عماره|مبنى|مبني)/g, "B"],
];

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d);
}

function prepare(s: string): string {
  let out = toLatinDigits(String(s ?? "")).trim();
  for (const [re, rep] of WORDS) out = out.replace(re, rep);
  return out.toUpperCase();
}

/**
 * Canonical key: groups of letters / digits joined by "-", so separators and case don't
 * matter but group boundaries do: "a01 - 101" → "A-01-101", "فيلا ١٢" → "VILLA-12",
 * and "Q1-110" ≠ "Q11-10".
 */
export function normalizeUnitCode(s: string): string {
  return (prepare(s).match(/[A-Z]+|[0-9]+|[\u0600-\u06FF]+/g) ?? []).join("-");
}

/** All separators removed ("A01101") — only used as a fallback when it is unambiguous. */
export function looseUnitCode(s: string): string {
  return prepare(s).replace(/[^A-Z0-9\u0600-\u06FF]+/g, "");
}

/** Look codes up by canonical key, falling back to the loose key only when it points to exactly one code. */
export function createCodeIndex<T>(items: T[], code: (t: T) => string) {
  const strict = new Map<string, T>();
  const loose = new Map<string, T | null>();
  for (const it of items) {
    strict.set(normalizeUnitCode(code(it)), it);
    const l = looseUnitCode(code(it));
    loose.set(l, loose.has(l) && loose.get(l) !== it ? null : it);
  }
  return {
    get(c: string): T | undefined {
      if (!c) return undefined;
      return strict.get(normalizeUnitCode(c)) ?? loose.get(looseUnitCode(c)) ?? undefined;
    },
  };
}

/** Tidy a code for storage (keeps the client's own format, just trimmed / upper-cased / Latin digits). */
export function cleanUnitCode(s: string): string {
  return toLatinDigits(String(s ?? "")).trim().replace(/\s+/g, " ").toUpperCase();
}

export interface UnitCodeMatch<T> {
  unit: T;
  /** The exact text that matched, so it can be removed from the message */
  matched: string;
}

/**
 * Find a known unit code inside free text ("A02-102 الحنفية بتسرب", "انا في فيلا 12").
 * Tries windows of 1–4 consecutive words, longest first.
 */
export function findUnitInText<T extends { code: string }>(text: string, units: T[]): UnitCodeMatch<T> | null {
  const index = createCodeIndex(units, (u) => u.code);
  const tokens = String(text ?? "").split(/\s+/).filter(Boolean);
  for (let size = Math.min(4, tokens.length); size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const piece = tokens.slice(i, i + size).join(" ");
      const stripped = piece.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const unit = index.get(stripped);
      if (unit) return { unit, matched: piece };
    }
  }
  return null;
}

/** Something that looks like an attempt at a unit code (has a digit, short) — for "not found" replies. */
export function guessUnitAttempt(text: string): string | null {
  const t = String(text ?? "").split(/\s+/).find((w) => /[0-9٠-٩]/.test(w) && w.length <= 14);
  return t ?? null;
}

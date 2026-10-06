import { z } from "zod";
import { CATEGORY_KEYS, PRIORITIES, isCategoryKey, isPriority, type CategoryKey, type Priority } from "@/server/domain/constants";
import { normalizeArabic, detectLanguage } from "@/lib/arabic";
import type { MaintenanceClassification, Severity } from "./types";

/**
 * Parses and validates LLM output. LLMs return JSON wrapped in prose, markdown
 * fences, with Arabic category names, percentages instead of fractions, etc.
 * Everything is normalized here; anything unusable throws AIParseError so the
 * caller can fall back to the deterministic provider.
 */

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown,
  ) {
    super(message);
  }
}

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
  }
  throw new AIParseError("No valid JSON object found in AI response", raw);
}

const CATEGORY_SYNONYMS: Record<string, CategoryKey> = {
  plumbing: "PLUMBING", plumber: "PLUMBING", "سباكه": "PLUMBING", water: "PLUMBING",
  electrical: "ELECTRICAL", electricity: "ELECTRICAL", electric: "ELECTRICAL", "كهرباء": "ELECTRICAL", "كهربا": "ELECTRICAL",
  hvac: "HVAC", ac: "HVAC", "air conditioning": "HVAC", "تكييف": "HVAC", "تكييف وتهويه": "HVAC",
  elevator: "ELEVATOR", lift: "ELEVATOR", elevators: "ELEVATOR", "مصاعد": "ELEVATOR", "اسانسير": "ELEVATOR",
  civil: "CIVIL", "اعمال مدنيه": "CIVIL", structural: "CIVIL",
  painting: "PAINTING", paint: "PAINTING", "دهانات": "PAINTING",
  carpentry: "CARPENTRY", carpenter: "CARPENTRY", "نجاره": "CARPENTRY",
  appliances: "APPLIANCES", appliance: "APPLIANCES", "اجهزه منزليه": "APPLIANCES",
  security: "SECURITY", "امن": "SECURITY",
  cleaning: "CLEANING", "نظافه": "CLEANING",
  landscaping: "LANDSCAPING", garden: "LANDSCAPING", "حدائق": "LANDSCAPING",
  other: "OTHER", general: "OTHER", "اخري": "OTHER",
};

/**
 * Map the AI's category to a known key. `allowed` = active category keys (built-in + custom);
 * anything not active becomes OTHER.
 */
export function normalizeCategory(v: unknown, allowed?: string[]): string {
  if (typeof v !== "string") return "OTHER";
  const up = v.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const ok = (k: string) => (allowed ? allowed.includes(k) : isCategoryKey(k));
  if (ok(up)) return up;
  if (allowed && isCategoryKey(up)) return "OTHER"; // built-in category a manager archived
  const n = normalizeArabic(v);
  const lookup = (term: string) => Object.entries(CATEGORY_SYNONYMS).find(([k]) => normalizeArabic(k) === term)?.[1];
  const hit = lookup(n) ?? lookup(n.split(" ")[0]) ?? "OTHER";
  return ok(hit) ? hit : "OTHER";
}

const PRIORITY_SYNONYMS: Record<string, Priority> = {
  urgent: "HIGH", immediate: "EMERGENCY", severe: "CRITICAL", normal: "MEDIUM", moderate: "MEDIUM", minor: "LOW",
  "طارئ": "EMERGENCY", "طارئه": "EMERGENCY", "حرج": "CRITICAL", "عاجل": "HIGH", "عالي": "HIGH", "متوسط": "MEDIUM", "منخفض": "LOW",
};

export function normalizePriority(v: unknown): Priority {
  if (typeof v !== "string") return "MEDIUM";
  const up = v.trim().toUpperCase();
  if (isPriority(up)) return up;
  const n = normalizeArabic(v);
  const hit = Object.entries(PRIORITY_SYNONYMS).find(([k]) => normalizeArabic(k) === n);
  return hit?.[1] ?? "MEDIUM";
}

export function normalizeConfidence(v: unknown): number {
  let n = typeof v === "string" ? parseFloat(v.replace("%", "")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

const SEVERITIES: Severity[] = ["minor", "moderate", "severe", "unknown"];

const looseString = z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v && v.trim() ? v.trim() : null));
const looseBool = z.union([z.boolean(), z.string(), z.null(), z.undefined()]).transform((v) =>
  typeof v === "string" ? ["true", "yes", "1"].includes(v.toLowerCase()) : Boolean(v),
);

export const RawClassificationSchema = z
  .object({
    isMaintenanceRequest: looseBool.optional(),
    is_maintenance_request: looseBool.optional(),
    category: z.unknown(),
    priority: z.unknown(),
    confidence: z.unknown(),
    title: looseString.optional(),
    issue: looseString.optional(),
    issueAr: looseString.optional(),
    issue_ar: looseString.optional(),
    location: looseString.optional(),
    assetType: looseString.optional(),
    asset_type: looseString.optional(),
    assetCode: looseString.optional(),
    severity: looseString.optional(),
    recommendedAction: looseString.optional(),
    recommended_action: looseString.optional(),
    reasoning: looseString.optional(),
    needsMoreInfo: looseBool.optional(),
    needs_more_info: looseBool.optional(),
    followUpQuestion: looseString.optional(),
    follow_up_question: looseString.optional(),
    language: looseString.optional(),
  })
  .passthrough();

export function parseClassificationResponse(raw: string | object, originalText = "", allowedCategories?: string[]): MaintenanceClassification {
  const json = typeof raw === "string" ? extractJson(raw) : raw;
  const parsed = RawClassificationSchema.safeParse(json);
  if (!parsed.success) throw new AIParseError(`Invalid classification shape: ${parsed.error.message}`, raw);
  const r = parsed.data;
  if (r.category === undefined && r.issue === undefined) throw new AIParseError("Classification missing category and issue", raw);

  const category = normalizeCategory(r.category, allowedCategories);
  const issue = r.issue ?? "Maintenance issue";
  const severityRaw = (r.severity ?? "unknown").toLowerCase() as Severity;
  const needsMoreInfo = Boolean(r.needsMoreInfo ?? r.needs_more_info);
  const followUpQuestion = r.followUpQuestion ?? r.follow_up_question ?? null;
  const lang = r.language === "en" || r.language === "ar" ? r.language : detectLanguage(originalText);

  return {
    isMaintenanceRequest: (r.isMaintenanceRequest ?? r.is_maintenance_request) !== false,
    category,
    priority: normalizePriority(r.priority),
    confidence: normalizeConfidence(r.confidence),
    title: r.title ?? (r.location ? `${issue} – ${r.location}` : issue),
    issue,
    issueAr: r.issueAr ?? r.issue_ar ?? null,
    location: r.location ?? null,
    assetType: r.assetType ?? r.asset_type ?? null,
    assetCode: r.assetCode ?? null,
    severity: SEVERITIES.includes(severityRaw) ? severityRaw : "unknown",
    recommendedAction: r.recommendedAction ?? r.recommended_action ?? "Manager triage required",
    reasoning: r.reasoning ?? "",
    needsMoreInfo: needsMoreInfo && !!followUpQuestion,
    followUpQuestion: needsMoreInfo ? followUpQuestion : null,
    language: lang,
  };
}

export const CLASSIFICATION_JSON_SHAPE = {
  isMaintenanceRequest: "boolean",
  category: CATEGORY_KEYS.join(" | "),
  priority: PRIORITIES.join(" | "),
  confidence: "number 0..1",
  title: "short English ticket title",
  issue: "short English issue, e.g. 'Water leakage'",
  issueAr: "same issue in Arabic",
  location: "room/area in English or null (Kitchen, Bathroom, Bedroom, Living room, Balcony, Entrance, Roof, Garage, Garden, Lobby)",
  assetType: "AC | Water Heater | Elevator | Water Pump | Generator | Electrical Panel | Door | Gate | Pipe | Light | null",
  assetCode: "asset code from the known assets list or null",
  severity: "minor | moderate | severe | unknown",
  recommendedAction: "short English action, e.g. 'Dispatch plumber'",
  reasoning: "one or two sentences explaining the classification",
  needsMoreInfo: "boolean — true only if a critical detail is missing",
  followUpQuestion: "ONE short question in the resident's language/dialect, or null",
  language: "ar | en",
};

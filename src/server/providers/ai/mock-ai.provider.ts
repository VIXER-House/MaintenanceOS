import { detectLanguage, findKeywords, matchKeyword, normalizeArabic } from "@/lib/arabic";
import { CATEGORY_CATALOG, CATEGORY_BY_KEY } from "@/server/domain/categories";
import { PRIORITY_RANK, priorityFromRank, type CategoryKey, type Priority } from "@/server/domain/constants";
import { GLOBAL_PRIORITY_RULES } from "@/server/engines/priority/rules";
import { renderTemplate } from "./templates";
import type {
  AIProvider,
  ExtractedMaintenanceData,
  MaintenanceClassification,
  MaintenanceInput,
  ResponseInput,
  Severity,
} from "./types";

/**
 * MockAIProvider — a deterministic Arabic/Egyptian-Arabic/English NLU.
 * It is the zero-dependency default AND the safety fallback when a real LLM is
 * unavailable, slow, or returns garbage. It is good enough to run the full
 * product (classification, entity extraction, follow-up questions) offline.
 */

const LOCATIONS: { en: string; ar: string; keywords: string[] }[] = [
  { en: "Kitchen", ar: "المطبخ", keywords: ["مطبخ", "kitchen"] },
  { en: "Bathroom", ar: "الحمام", keywords: ["حمام", "تواليت", "bathroom", "toilet", "wc"] },
  { en: "Master bedroom", ar: "غرفة النوم الرئيسية", keywords: ["اوضه النوم الرئيسيه", "الماستر", "master bedroom"] },
  { en: "Kids room", ar: "أوضة الأطفال", keywords: ["اوضه الاطفال", "اوضه العيال", "kids room"] },
  { en: "Bedroom", ar: "غرفة النوم", keywords: ["اوضه النوم", "غرفه النوم", "اوضه نوم", "الاوضه", "bedroom"] },
  { en: "Living room", ar: "الصالة", keywords: ["صاله", "ريسبشن", "الليفنج", "living room", "reception", "salon"] },
  { en: "Balcony", ar: "البلكونة", keywords: ["بلكونه", "تراس", "balcony", "terrace"] },
  { en: "Entrance", ar: "المدخل", keywords: ["مدخل", "entrance", "lobby"] },
  { en: "Staircase", ar: "السلم", keywords: ["السلم", "staircase", "stairs"] },
  { en: "Roof", ar: "السطح", keywords: ["سطح", "روف", "roof"] },
  { en: "Garage", ar: "الجراج", keywords: ["جراج", "باركينج", "garage", "parking"] },
  { en: "Garden", ar: "الجنينة", keywords: ["جنينه", "حديقه", "garden"] },
  { en: "Main gate", ar: "البوابة الرئيسية", keywords: ["البوابه الرئيسيه", "البوابه", "main gate", "gate"] },
  { en: "Ceiling", ar: "السقف", keywords: ["سقف", "ceiling"] },
];

interface IssuePattern {
  keywords: string[];
  en: string;
  ar: string;
  asset?: string;
}

const ISSUES: Partial<Record<CategoryKey, IssuePattern[]>> = {
  HVAC: [
    { keywords: ["مش بيبرد", "مبيبردش", "مش بتبرد", "بيطلع هوا سخن", "not cooling", "warm air"], en: "Cooling failure", ar: "التكييف مش بيبرد", asset: "AC" },
    { keywords: ["بينقط", "بيخر", "بينزل ميه", "dripping", "leaking water"], en: "AC dripping water", ar: "التكييف بينقط مياه", asset: "AC" },
    { keywords: ["صوت", "بيزيق", "noise", "noisy"], en: "Noisy AC unit", ar: "صوت عالي في التكييف", asset: "AC" },
    { keywords: ["كمبروسر", "compressor"], en: "Compressor failure", ar: "عطل في الكمبروسر", asset: "AC" },
    { keywords: ["مش شغال", "مبيشتغلش", "عطلان", "واقف", "not working", "broken", "won't turn on"], en: "AC not working", ar: "التكييف مش شغال", asset: "AC" },
  ],
  PLUMBING: [
    { keywords: ["انفجر", "انفجرت", "ضربت", "burst"], en: "Burst pipe", ar: "ماسورة منفجرة", asset: "Pipe" },
    { keywords: ["مسدود", "انسداد", "بلاعه", "clogged", "blocked"], en: "Blocked drain", ar: "انسداد في الصرف", asset: "Drain" },
    { keywords: ["ضعيفه", "ضعيف", "ضغط", "low pressure", "weak"], en: "Low water pressure", ar: "ضعف في ضغط المياه", asset: "Water Pump" },
    { keywords: ["مفيش مياه", "المياه قاطعه", "الميه قاطعه", "no water"], en: "No water supply", ar: "انقطاع المياه", asset: "Water Pump" },
    { keywords: ["حنفيه", "خلاط", "tap", "faucet"], en: "Leaking tap", ar: "تسريب من الحنفية", asset: "Tap" },
    { keywords: ["سيفون", "flush"], en: "Toilet flush fault", ar: "عطل في السيفون", asset: "Toilet" },
    { keywords: ["تسريب", "بيسرب", "بتسرب", "بيخر", "بتخر", "بينقط", "leak", "leaking"], en: "Water leakage", ar: "تسريب مياه", asset: "Pipe" },
  ],
  ELECTRICAL: [
    { keywords: ["شرار", "شراره", "ماس", "sparks", "short circuit"], en: "Electrical sparking", ar: "شرار كهربائي", asset: "Electrical Panel" },
    { keywords: ["قاطعه", "مفيش كهربا", "مفيش كهرباء", "النور قاطع", "power outage", "no power", "no electricity"], en: "Power outage", ar: "انقطاع الكهرباء", asset: "Electrical Panel" },
    { keywords: ["سكينه", "بيفصل", "breaker", "tripping"], en: "Breaker tripping", ar: "السكينة بتفصل", asset: "Electrical Panel" },
    { keywords: ["لمبه", "لمبات", "اناره", "اتحرقت", "bulb", "lamp"], en: "Burnt-out light", ar: "لمبة محروقة", asset: "Light" },
    { keywords: ["فيشه", "بريزه", "socket", "outlet"], en: "Faulty socket", ar: "عطل في الفيشة", asset: "Socket" },
  ],
  ELEVATOR: [
    { keywords: ["محبوس", "محبوسين", "اتحبس", "trapped", "stuck inside"], en: "Person trapped in elevator", ar: "شخص محبوس في الأسانسير", asset: "Elevator" },
    { keywords: ["واقف", "عطلان", "مش شغال", "stopped", "not working", "out of service"], en: "Elevator out of service", ar: "الأسانسير عطلان", asset: "Elevator" },
    { keywords: ["باب", "door"], en: "Elevator door fault", ar: "عطل في باب الأسانسير", asset: "Elevator" },
    { keywords: ["صوت", "noise"], en: "Elevator noise", ar: "صوت في الأسانسير", asset: "Elevator" },
  ],
  APPLIANCES: [
    { keywords: ["سخان", "heater", "boiler"], en: "Water heater not working", ar: "السخان مش شغال", asset: "Water Heater" },
    { keywords: ["بوتجاز", "فرن", "stove", "oven"], en: "Cooker fault", ar: "عطل في البوتجاز", asset: "Cooker" },
  ],
  CARPENTRY: [
    { keywords: ["مش بيقفل", "مبيقفلش", "كالون", "قفل", "won't lock", "lock"], en: "Door does not lock", ar: "الباب مش بيقفل", asset: "Door" },
    { keywords: ["مفصله", "hinge"], en: "Broken hinge", ar: "مفصلة مكسورة", asset: "Door" },
    { keywords: ["دولاب", "ضلفه", "cabinet", "wardrobe"], en: "Cabinet repair", ar: "إصلاح دولاب", asset: "Cabinet" },
  ],
  SECURITY: [
    { keywords: ["البوابه", "بوابه", "gate", "barrier"], en: "Gate malfunction", ar: "عطل في البوابة", asset: "Gate" },
    { keywords: ["كاميرا", "camera", "cctv"], en: "CCTV camera fault", ar: "عطل في الكاميرا", asset: "CCTV" },
    { keywords: ["انتركم", "intercom"], en: "Intercom fault", ar: "عطل في الانتركم", asset: "Intercom" },
  ],
  LANDSCAPING: [
    { keywords: ["شجره وقعت", "وقعت", "fallen tree"], en: "Fallen tree", ar: "شجرة واقعة" },
    { keywords: ["رشاشات", "ري", "sprinkler", "irrigation"], en: "Irrigation system fault", ar: "عطل في الرشاشات" },
    { keywords: ["نجيله", "قص", "grass", "lawn"], en: "Lawn maintenance", ar: "قص النجيلة" },
  ],
  CLEANING: [
    { keywords: ["صراصير", "حشرات", "فيران", "فئران", "pest", "cockroach", "rats"], en: "Pest infestation", ar: "حشرات" },
    { keywords: ["زباله", "قمامه", "garbage", "trash"], en: "Garbage not collected", ar: "الزبالة متراكمة" },
  ],
  PAINTING: [{ keywords: ["دهان", "بويه", "paint"], en: "Repainting needed", ar: "محتاج دهان" }],
  CIVIL: [
    { keywords: ["شرخ", "شروخ", "crack"], en: "Wall/ceiling crack", ar: "شرخ في الحائط" },
    { keywords: ["رطوبه", "damp"], en: "Dampness", ar: "رطوبة" },
    { keywords: ["سيراميك", "بلاط", "tile"], en: "Broken tiles", ar: "بلاط مكسور" },
  ],
};

const SEVERE = ["كتير", "جامد", "بيغرق", "بتغرق", "غرقت", "مغرقه", "خطر", "بسرعه", "حالا", "a lot", "heavy", "severe", "flooding", "dangerous", "urgent"];
const MINOR = ["بسيط", "خفيف", "شويه", "حاجه بسيطه", "نقطه نقطه", "minor", "small", "a little", "slight"];
const GREETINGS = ["السلام عليكم", "سلام", "اهلا", "مرحبا", "صباح الخير", "مساء الخير", "hi", "hello", "hey", "شكرا", "thanks", "thank you"];
const DEVICE_CATEGORIES: CategoryKey[] = ["ELEVATOR", "HVAC", "APPLIANCES", "SECURITY"];

function scoreCategories(text: string, imageFindings: MaintenanceInput["imageFindings"]) {
  const n = normalizeArabic(text);
  const scores = CATEGORY_CATALOG.filter((c) => c.key !== "OTHER").map((c) => {
    const hits = c.keywords.filter((k) => matchKeyword(n, k));
    let score = hits.length;
    if (hits.length && DEVICE_CATEGORIES.includes(c.key)) score += 1.5;
    for (const f of imageFindings ?? []) if (f.categoryKey === c.key) score += 2 * f.confidence;
    return { key: c.key, score, hits };
  });
  return scores.sort((a, b) => b.score - a.score);
}

function pickIssue(category: CategoryKey, text: string): IssuePattern | null {
  const n = normalizeArabic(text);
  for (const p of ISSUES[category] ?? []) if (p.keywords.some((k) => matchKeyword(n, k))) return p;
  return null;
}

function extract(input: MaintenanceInput, category?: CategoryKey): ExtractedMaintenanceData {
  const text = fullText(input);
  const n = normalizeArabic(text);
  const loc = LOCATIONS.find((l) => l.keywords.some((k) => matchKeyword(n, k)));
  const severity: Severity = SEVERE.some((k) => matchKeyword(n, k))
    ? "severe"
    : MINOR.some((k) => matchKeyword(n, k))
      ? "minor"
      : "unknown";
  const urgencySignals = GLOBAL_PRIORITY_RULES.flatMap((r) => findKeywords(text, r.keywords));
  const issue = category ? pickIssue(category, text) : null;
  let assetCode: string | null = null;
  let assetType = issue?.asset ?? null;
  if (input.knownAssets?.length && assetType) {
    const candidates = input.knownAssets.filter((a) => a.type.toLowerCase() === assetType!.toLowerCase());
    const byLoc = loc ? candidates.find((a) => a.location.toLowerCase().includes(loc.en.toLowerCase())) : null;
    // Only fall back to "the only one" when no (conflicting) location was mentioned
    const chosen = byLoc ?? (!loc && candidates.length === 1 ? candidates[0] : null);
    if (chosen) {
      assetCode = chosen.assetCode;
      assetType = chosen.type;
    }
  }
  return {
    location: loc?.en ?? null,
    room: loc?.ar ?? null,
    assetType,
    assetCode,
    symptoms: issue ? [issue.en] : [],
    urgencySignals,
    severity,
  };
}

function fullText(input: MaintenanceInput): string {
  const prev = (input.history ?? []).filter((t) => t.role === "resident").map((t) => t.text);
  return [...prev, input.text].join(" \n ");
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "rules-nlu-v1";

  async classifyMaintenanceRequest(input: MaintenanceInput): Promise<MaintenanceClassification> {
    const text = fullText(input);
    const language = input.language ?? detectLanguage(input.text);
    const ranked = scoreCategories(text, input.imageFindings);
    const top = ranked[0];
    const second = ranked[1];
    const n = normalizeArabic(text);
    const isGreetingOnly = top.score === 0 && GREETINGS.some((g) => matchKeyword(n, g));

    const category: CategoryKey = top.score > 0 ? top.key : "OTHER";
    const def = CATEGORY_BY_KEY[category];
    const confidence =
      top.score > 0 ? Math.min(0.97, 0.6 + 0.08 * top.score + 0.06 * (top.score - (second?.score ?? 0))) : 0.3;

    const entities = extract(input, category);
    const issue = pickIssue(category, text);
    const issueEn = issue?.en ?? (category === "OTHER" ? "Unclassified maintenance request" : `${def.nameEn} issue`);
    const issueAr = issue?.ar ?? (category === "OTHER" ? "طلب صيانة غير مصنف" : `مشكلة ${def.nameAr}`);

    // Suggested priority: category default, nudged by severity / urgency vocabulary.
    let rank = PRIORITY_RANK[def.defaultPriority];
    for (const r of [...GLOBAL_PRIORITY_RULES, ...def.priorityRules]) {
      if (findKeywords(text, r.keywords).length) rank = Math.max(rank, PRIORITY_RANK[r.priority]);
    }
    const lowered = def.priorityRules.find((r) => PRIORITY_RANK[r.priority] < rank && findKeywords(text, r.keywords).length);
    if (lowered && !entities.urgencySignals.length) rank = PRIORITY_RANK[lowered.priority];
    if (entities.severity === "severe") rank = Math.min(5, rank + 1);
    if (entities.severity === "minor") rank = Math.max(1, rank - 1);
    const priority: Priority = priorityFromRank(rank);

    // Follow-up questions: only for genuinely missing, decision-relevant details.
    let followUpQuestion: string | null = null;
    if (!input.disallowFollowUp && !isGreetingOnly) {
      if (category === "OTHER" || confidence < 0.5) {
        followUpQuestion =
          language === "ar"
            ? "ممكن توضحلي المشكلة أكتر؟ إيه اللي عطلان بالظبط وفين في الشقة؟"
            : "Could you describe the problem in more detail — what exactly is broken and where in the unit?";
      } else if (
        category === "PLUMBING" &&
        issue?.en === "Water leakage" &&
        entities.severity === "unknown" &&
        !entities.urgencySignals.some((s) => ["انفجر", "انفجرت", "burst", "flood"].includes(s))
      ) {
        followUpQuestion =
          language === "ar"
            ? "محتاج أعرف هل التسريب بسيط ولا المياه بتغرق المكان؟"
            : "Is the leak minor, or is water flooding the area?";
      } else if (category === "ELEVATOR" && !matchKeyword(n, "محبوس") && !matchKeyword(n, "trapped") && !/مفيش حد|no one/.test(n)) {
        followUpQuestion =
          language === "ar" ? "هل في حد محبوس جوه الأسانسير دلوقتي؟" : "Is anyone trapped inside the elevator right now?";
      }
    }

    const hitList = top.hits.length ? top.hits.join("، ") : "none";
    const reasoning = [
      top.score > 0 ? `Matched ${def.nameEn} vocabulary (${hitList}).` : "No maintenance vocabulary matched.",
      issue ? `Symptom pattern → "${issue.en}".` : "",
      entities.location ? `Location: ${entities.location}.` : "",
      entities.severity !== "unknown" ? `Severity cue: ${entities.severity}.` : "",
      entities.urgencySignals.length ? `Urgency signals: ${entities.urgencySignals.join(", ")}.` : "",
      (input.imageFindings ?? []).length ? `Image analysis considered.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      isMaintenanceRequest: !isGreetingOnly,
      category,
      priority,
      confidence: Math.round(confidence * 100) / 100,
      title: entities.location ? `${issueEn} – ${entities.location}` : issueEn,
      issue: issueEn,
      issueAr,
      location: entities.location,
      assetType: entities.assetType,
      assetCode: entities.assetCode,
      severity: entities.severity,
      recommendedAction: def.recommendedActionEn,
      reasoning,
      needsMoreInfo: !!followUpQuestion,
      followUpQuestion,
      language,
    };
  }

  async extractEntities(input: MaintenanceInput): Promise<ExtractedMaintenanceData> {
    const top = scoreCategories(fullText(input), input.imageFindings)[0];
    return extract(input, top.score > 0 ? top.key : undefined);
  }

  async generateResponse(input: ResponseInput): Promise<string> {
    return renderTemplate(input);
  }
}

/** True when the text contains any maintenance vocabulary (a category keyword or symptom). */
export function hasMaintenanceVocabulary(text: string): boolean {
  return scoreCategories(text, undefined)[0]?.score > 0;
}

import type { CategoryKey, Priority } from "./constants";

export interface PriorityRule {
  keywords: string[];
  priority: Priority;
  reason: string;
}

export interface CategoryDefinition {
  key: CategoryKey;
  nameEn: string;
  nameAr: string;
  description: string;
  defaultResolutionMinutes: number;
  requiredSkill: string;
  defaultPriority: Priority;
  /** Category-specific configurable rules (stored in DB, seeded from here) */
  priorityRules: PriorityRule[];
  quotationThreshold: number;
  icon: string;
  /** Detection vocabulary for the deterministic NLU (Arabic, Egyptian Arabic, English) */
  keywords: string[];
  recommendedActionEn: string;
  recommendedActionAr: string;
}

const H = 60;

export const CATEGORY_CATALOG: CategoryDefinition[] = [
  {
    key: "PLUMBING",
    nameEn: "Plumbing",
    nameAr: "سباكة",
    description: "Leaks, pipes, taps, drains, toilets, water pressure and water supply.",
    defaultResolutionMinutes: 24 * H,
    requiredSkill: "PLUMBING",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["تسريب", "بيسرب", "بتسرب", "بيخر", "بتخر", "leak", "leaking", "dripping"], priority: "HIGH", reason: "Active water leak" },
      { keywords: ["مسدود", "انسداد", "بلاعه", "clogged", "blocked drain"], priority: "MEDIUM", reason: "Blocked drain" },
      { keywords: ["المياه ضعيفه", "ضغط المياه", "مياه ضعيفه", "low pressure", "weak water"], priority: "MEDIUM", reason: "Low water pressure" },
      { keywords: ["مفيش مياه", "المياه قاطعه", "no water"], priority: "HIGH", reason: "No water supply to unit" },
    ],
    quotationThreshold: 1500,
    icon: "Droplets",
    keywords: [
      "مياه", "ميه", "مايه", "تسريب", "بيسرب", "بتسرب", "بيخر", "بتخر", "ماسوره", "مواسير", "حنفيه", "حنفيات", "خلاط",
      "صرف", "بلاعه", "مسدود", "سيفون", "تواليت", "حمام", "حوض", "بانيو", "دش", "شطاف", "سباك", "سباكه", "ضغط المياه",
      "water", "leak", "leaking", "pipe", "tap", "faucet", "drain", "toilet", "sink", "plumbing", "plumber", "flush", "burst",
    ],
    recommendedActionEn: "Dispatch plumber",
    recommendedActionAr: "إرسال فني سباكة",
  },
  {
    key: "ELECTRICAL",
    nameEn: "Electrical",
    nameAr: "كهرباء",
    description: "Power outages, sockets, breakers, wiring and lighting.",
    defaultResolutionMinutes: 24 * H,
    requiredSkill: "ELECTRICAL",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["لمبه", "لمبات", "اناره", "نجفه", "سبوت", "bulb", "lamp", "light bulb"], priority: "LOW", reason: "Lighting fixture only" },
      { keywords: ["فيشه", "بريزه", "مفتاح النور", "socket", "outlet", "switch"], priority: "MEDIUM", reason: "Socket / switch fault" },
      { keywords: ["الكهربا قاطعه", "الكهرباء قاطعه", "مفيش كهربا", "مفيش كهرباء", "النور قاطع", "power outage", "no power", "no electricity"], priority: "HIGH", reason: "Power outage in unit" },
      { keywords: ["السكينه", "القاطع بيفصل", "breaker", "tripping"], priority: "HIGH", reason: "Breaker tripping" },
    ],
    quotationThreshold: 1500,
    icon: "Zap",
    keywords: [
      "كهربا", "كهرباء", "نور", "لمبه", "لمبات", "اناره", "فيشه", "بريزه", "سلك", "اسلاك", "سكينه", "قاطع", "لوحه الكهربا",
      "مفتاح النور", "نجفه", "كشاف", "كهربائي",
      "electric", "electricity", "power", "light", "bulb", "lamp", "socket", "outlet", "breaker", "wiring", "switch",
    ],
    recommendedActionEn: "Dispatch electrician",
    recommendedActionAr: "إرسال فني كهرباء",
  },
  {
    key: "HVAC",
    nameEn: "HVAC",
    nameAr: "تكييف وتهوية",
    description: "Air conditioners, ventilation, cooling and heating.",
    defaultResolutionMinutes: 48 * H,
    requiredSkill: "HVAC",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["بينقط", "بيخر ميه", "dripping water"], priority: "MEDIUM", reason: "AC condensate leak" },
      { keywords: ["ريحه حريق", "بيطلع دخان", "burning smell"], priority: "CRITICAL", reason: "Burning smell from AC" },
      { keywords: ["فلتر", "تنظيف التكييف", "filter", "service"], priority: "LOW", reason: "Routine AC service" },
    ],
    quotationThreshold: 2000,
    icon: "AirVent",
    keywords: [
      "تكييف", "التكييف", "مكيف", "تكيف", "يبرد", "بيبرد", "مش بيبرد", "كمبروسر", "فريون", "غاز التكييف", "شفاط", "تهويه",
      "ac", "a/c", "air conditioner", "air conditioning", "aircon", "cooling", "hvac", "compressor", "ventilation", "freon",
    ],
    recommendedActionEn: "Send HVAC technician",
    recommendedActionAr: "إرسال فني تكييف",
  },
  {
    key: "ELEVATOR",
    nameEn: "Elevator",
    nameAr: "مصاعد",
    description: "Elevator breakdowns, doors, noise and entrapments.",
    defaultResolutionMinutes: 8 * H,
    requiredSkill: "ELEVATOR",
    defaultPriority: "HIGH",
    priorityRules: [
      { keywords: ["واقف", "عطلان", "مش شغال", "stopped", "not working", "out of service"], priority: "CRITICAL", reason: "Elevator out of service" },
      { keywords: ["صوت", "بيزيق", "noise", "noisy"], priority: "MEDIUM", reason: "Elevator noise" },
    ],
    quotationThreshold: 3000,
    icon: "ArrowUpDown",
    keywords: ["اسانسير", "الاسانسير", "مصعد", "المصعد", "اصنصير", "elevator", "lift"],
    recommendedActionEn: "Dispatch elevator contractor",
    recommendedActionAr: "إرسال شركة المصاعد",
  },
  {
    key: "CIVIL",
    nameEn: "Civil",
    nameAr: "أعمال مدنية",
    description: "Cracks, ceilings, walls, tiles, waterproofing and structural defects.",
    defaultResolutionMinutes: 72 * H,
    requiredSkill: "CIVIL",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["شرخ كبير", "السقف بيقع", "سقوط", "انهيار", "collapse", "structural"], priority: "CRITICAL", reason: "Possible structural risk" },
      { keywords: ["سيراميك", "بلاط", "tile"], priority: "LOW", reason: "Tiles / finishing" },
    ],
    quotationThreshold: 2500,
    icon: "Building2",
    keywords: ["شرخ", "شروخ", "سقف", "حيطه", "حائط", "جدار", "سيراميك", "بلاط", "رطوبه", "عزل", "محاره", "crack", "ceiling", "wall", "tile", "tiles", "damp", "waterproofing", "plaster"],
    recommendedActionEn: "Send civil works team for inspection",
    recommendedActionAr: "إرسال فريق الأعمال المدنية للمعاينة",
  },
  {
    key: "PAINTING",
    nameEn: "Painting",
    nameAr: "دهانات",
    description: "Interior and exterior painting and touch-ups.",
    defaultResolutionMinutes: 120 * H,
    requiredSkill: "PAINTING",
    defaultPriority: "LOW",
    priorityRules: [],
    quotationThreshold: 1000,
    icon: "Paintbrush",
    keywords: ["دهان", "دهانات", "نقاش", "بويه", "طلاء", "paint", "painting", "repaint"],
    recommendedActionEn: "Schedule painter",
    recommendedActionAr: "جدولة زيارة النقاش",
  },
  {
    key: "CARPENTRY",
    nameEn: "Carpentry",
    nameAr: "نجارة",
    description: "Doors, locks, cabinets, wardrobes and wooden fixtures.",
    defaultResolutionMinutes: 48 * H,
    requiredSkill: "CARPENTRY",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["الباب مش بيقفل", "باب الشقه", "الكالون", "main door", "door won't lock", "lock broken"], priority: "HIGH", reason: "Unit cannot be secured" },
      { keywords: ["دولاب", "مطبخ", "ضلفه", "cabinet", "wardrobe"], priority: "LOW", reason: "Cabinet / furniture" },
    ],
    quotationThreshold: 1500,
    icon: "Hammer",
    keywords: ["باب", "الباب", "كالون", "قفل", "مفصله", "دولاب", "ضلفه", "خشب", "نجار", "شباك", "door", "lock", "hinge", "cabinet", "wardrobe", "wood", "carpenter", "window"],
    recommendedActionEn: "Send carpenter",
    recommendedActionAr: "إرسال نجار",
  },
  {
    key: "APPLIANCES",
    nameEn: "Appliances",
    nameAr: "أجهزة منزلية",
    description: "Water heaters, kitchen appliances and built-in equipment.",
    defaultResolutionMinutes: 48 * H,
    requiredSkill: "APPLIANCES",
    defaultPriority: "MEDIUM",
    priorityRules: [
      { keywords: ["ريحه غاز", "السخان بيسرب غاز", "gas smell"], priority: "EMERGENCY", reason: "Gas appliance hazard" },
    ],
    quotationThreshold: 1500,
    icon: "Flame",
    keywords: ["سخان", "السخان", "بوتجاز", "فرن", "تلاجه", "غساله", "ديب فريزر", "شفاط المطبخ", "heater", "water heater", "boiler", "stove", "oven", "fridge", "washing machine", "appliance"],
    recommendedActionEn: "Send appliance technician",
    recommendedActionAr: "إرسال فني أجهزة",
  },
  {
    key: "SECURITY",
    nameEn: "Security",
    nameAr: "أمن وبوابات",
    description: "Gates, barriers, intercoms, CCTV and access control.",
    defaultResolutionMinutes: 12 * H,
    requiredSkill: "SECURITY",
    defaultPriority: "HIGH",
    priorityRules: [
      { keywords: ["كاميرا", "انتركم", "camera", "cctv", "intercom"], priority: "MEDIUM", reason: "Surveillance / intercom fault" },
    ],
    quotationThreshold: 2000,
    icon: "ShieldCheck",
    keywords: ["بوابه", "البوابه", "بوابة", "امن", "كاميرا", "كاميرات", "انتركم", "بارير", "حارس", "gate", "barrier", "security", "cctv", "camera", "intercom", "access card"],
    recommendedActionEn: "Notify security & dispatch technician",
    recommendedActionAr: "إبلاغ الأمن وإرسال فني",
  },
  {
    key: "CLEANING",
    nameEn: "Cleaning",
    nameAr: "نظافة",
    description: "Common-area cleaning, garbage and pest control.",
    defaultResolutionMinutes: 24 * H,
    requiredSkill: "CLEANING",
    defaultPriority: "LOW",
    priorityRules: [
      { keywords: ["حشرات", "صراصير", "فئران", "pest", "rats", "cockroach"], priority: "MEDIUM", reason: "Pest control needed" },
    ],
    quotationThreshold: 1000,
    icon: "Sparkles",
    keywords: ["نظافه", "تنظيف", "زباله", "قمامه", "وساخه", "حشرات", "صراصير", "فئران", "cleaning", "garbage", "trash", "dirty", "pest", "cockroach"],
    recommendedActionEn: "Dispatch cleaning crew",
    recommendedActionAr: "إرسال فريق النظافة",
  },
  {
    key: "LANDSCAPING",
    nameEn: "Landscaping",
    nameAr: "حدائق ولاندسكيب",
    description: "Gardens, irrigation, trees and green areas.",
    defaultResolutionMinutes: 72 * H,
    requiredSkill: "LANDSCAPING",
    defaultPriority: "LOW",
    priorityRules: [
      { keywords: ["شجره وقعت", "fallen tree"], priority: "HIGH", reason: "Fallen tree" },
    ],
    quotationThreshold: 1500,
    icon: "Trees",
    keywords: ["جنينه", "حديقه", "زرع", "شجر", "شجره", "نجيله", "رشاشات", "ري", "garden", "landscaping", "tree", "grass", "irrigation", "sprinkler"],
    recommendedActionEn: "Dispatch landscaping team",
    recommendedActionAr: "إرسال فريق الحدائق",
  },
  {
    key: "OTHER",
    nameEn: "Other",
    nameAr: "أخرى",
    description: "Anything that does not fit another category.",
    defaultResolutionMinutes: 72 * H,
    requiredSkill: "GENERAL",
    defaultPriority: "LOW",
    priorityRules: [],
    quotationThreshold: 1500,
    icon: "Wrench",
    keywords: [],
    recommendedActionEn: "Manager triage required",
    recommendedActionAr: "يحتاج مراجعة من مدير الصيانة",
  },
];

export const CATEGORY_BY_KEY: Record<string, CategoryDefinition> = Object.fromEntries(
  CATEGORY_CATALOG.map((c) => [c.key, c]),
);

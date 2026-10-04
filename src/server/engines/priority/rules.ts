import type { PriorityRule } from "@/server/domain/categories";

/**
 * Global safety rules. These apply regardless of category and act as a FLOOR:
 * neither the AI nor a category default can push a ticket below them.
 * Configurable: extend this list (or load from DB/config) without touching the engine.
 */
export const GLOBAL_PRIORITY_RULES: PriorityRule[] = [
  {
    priority: "EMERGENCY",
    reason: "Burst pipe / flooding",
    keywords: [
      "انفجر", "انفجرت", "ماسوره ضربت", "ماسوره انفجرت", "بتغرق", "غرقت", "غرق", "المياه كتير", "مياه كتير", "الميه كتير",
      "burst", "burst pipe", "flooding", "flooded", "flood",
    ],
  },
  {
    priority: "EMERGENCY",
    reason: "Fire / smoke",
    keywords: ["حريق", "حريقه", "مولعه", "ولعت", "دخان", "fire", "smoke", "burning"],
  },
  {
    priority: "EMERGENCY",
    reason: "Gas leak",
    keywords: ["ريحه غاز", "تسريب غاز", "الغاز بيسرب", "gas leak", "gas smell", "smell of gas"],
  },
  {
    priority: "EMERGENCY",
    reason: "Electrical hazard",
    keywords: ["شرار", "شراره", "ماس كهربائي", "الكهربا ماسكه", "بتكهرب", "اتكهرب", "sparks", "sparking", "electric shock", "short circuit"],
  },
  {
    priority: "EMERGENCY",
    reason: "Person trapped",
    keywords: ["محبوس", "محبوسين", "اتحبس", "اتحبسوا", "عالق", "trapped", "stuck inside", "stuck in the elevator", "stuck in elevator"],
  },
  {
    priority: "CRITICAL",
    reason: "Building-wide outage",
    keywords: [
      "العماره كلها", "المبني كله", "الكمبوند كله", "كل الشقق", "whole building", "entire building", "all units",
      "المولد", "مولد الكهربا", "generator", "طلمبه المياه", "الطلمبه", "water pump",
    ],
  },
  {
    priority: "HIGH",
    reason: "Active water leak",
    keywords: ["تسريب", "بيسرب", "بتسرب", "بيخر", "بتخر", "سقف بينقط", "leak", "leaking"],
  },
];

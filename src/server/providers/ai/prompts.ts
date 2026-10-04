import { CATEGORY_CATALOG } from "@/server/domain/categories";
import { CLASSIFICATION_JSON_SHAPE } from "./parser";
import type { MaintenanceInput, ResponseInput } from "./types";

export const CLASSIFY_SYSTEM_PROMPT = `You are the triage engine of MaintenanceOS, a maintenance management system for residential compounds in Egypt.
Residents write in Egyptian Arabic (عامية مصرية), Modern Standard Arabic or English, often informally and with typos.
Classify the maintenance request and extract entities. Respond with ONE JSON object and nothing else.

Categories (use the KEY):
${CATEGORY_CATALOG.map((c) => `- ${c.key}: ${c.nameEn} / ${c.nameAr} — ${c.description}`).join("\n")}

Priorities:
- EMERGENCY: risk to life/property right now (burst pipe, flooding, fire, smoke, gas smell, sparks, person trapped in elevator)
- CRITICAL: building-wide outage or out-of-service elevator, structural risk
- HIGH: active leak, power outage in a unit, unit cannot be locked
- MEDIUM: appliance/AC not working, blocked drain, low water pressure
- LOW: cosmetic, light bulb, painting, routine service

Rules:
- Only ask a follow-up question (needsMoreInfo=true) if a detail that changes priority or dispatch is missing
  (e.g. size of a water leak, whether someone is trapped). Ask in the resident's dialect. Never ask more than one question.
- Do NOT invent asset codes; only use codes from the known assets list.
- Greetings or thanks alone are NOT maintenance requests (isMaintenanceRequest=false).

JSON shape:
${JSON.stringify(CLASSIFICATION_JSON_SHAPE, null, 2)}

Examples:
"المياه بتسرب من سقف الحمام" → {"category":"PLUMBING","priority":"HIGH","issue":"Water leakage","issueAr":"تسريب مياه","location":"Bathroom","assetType":"Pipe","recommendedAction":"Dispatch plumber", ...}
"التكييف في أوضة النوم مش بيبرد" → {"category":"HVAC","priority":"MEDIUM","issue":"Cooling failure","location":"Bedroom","assetType":"AC","recommendedAction":"Send HVAC technician", ...}
"الأسانسير واقف" → {"category":"ELEVATOR","priority":"CRITICAL","needsMoreInfo":true,"followUpQuestion":"هل في حد محبوس جوه الأسانسير دلوقتي؟", ...}`;

export function buildClassifyUserPrompt(input: MaintenanceInput): string {
  const parts: string[] = [];
  if (input.history?.length) {
    parts.push("Conversation so far:");
    for (const t of input.history) parts.push(`${t.role === "resident" ? "Resident" : "Assistant"}: ${t.text}`);
  }
  parts.push(`Resident message: ${input.text}`);
  if (input.imageFindings?.length) {
    parts.push(`Attached image analysis: ${input.imageFindings.map((f) => `${f.issue} (${Math.round(f.confidence * 100)}%)`).join("; ")}`);
  }
  if (input.knownAssets?.length) {
    parts.push(`Known assets in this unit: ${input.knownAssets.map((a) => `${a.assetCode} = ${a.name} (${a.type}, ${a.location})`).join("; ")}`);
  }
  if (input.disallowFollowUp) parts.push("A follow-up question was already asked: set needsMoreInfo=false.");
  return parts.join("\n");
}

export function buildReplyPrompt(input: ResponseInput, draft: string): string {
  return `Rewrite this WhatsApp message for a resident in ${input.language === "ar" ? "friendly Egyptian Arabic" : "friendly, concise English"}.
Keep EVERY fact exactly (ticket numbers, priorities, times, names, amounts). Do not add new facts. Max 4 short lines. Output only the message.

Message:
${draft}`;
}

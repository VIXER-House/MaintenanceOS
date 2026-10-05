import { getConfig } from "@/lib/config";
import { findKeywords } from "@/lib/arabic";
import { CATEGORY_CATALOG } from "@/server/domain/categories";
import { normalizeCategory, normalizeConfidence, extractJson } from "../ai/parser";
import { fetchJson } from "../http";
import { GEMINI_DEFAULT_MODEL, geminiGenerate, geminiText } from "../gemini";

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string | null;
}

export interface ImageAnalysis {
  issue: string;
  categoryKey: string | null;
  confidence: number;
  description: string;
  provider: string;
}

export interface VisionProvider {
  readonly name: string;
  analyzeImage(input: ImageInput): Promise<ImageAnalysis>;
}

const VISUAL_HINTS: { keywords: string[]; issue: string; categoryKey: string; confidence: number }[] = [
  { keywords: ["leak", "pipe", "water", "drip", "تسريب", "ماسوره"], issue: "Pipe leakage", categoryKey: "PLUMBING", confidence: 0.88 },
  { keywords: ["ac", "aircon", "split", "hvac", "تكييف"], issue: "AC unit fault (visible condensate/ice)", categoryKey: "HVAC", confidence: 0.8 },
  { keywords: ["socket", "wire", "panel", "breaker", "burn", "فيشه", "كهربا"], issue: "Damaged electrical fitting", categoryKey: "ELECTRICAL", confidence: 0.82 },
  { keywords: ["crack", "ceiling", "wall", "damp", "شرخ", "رطوبه"], issue: "Wall/ceiling crack or damp patch", categoryKey: "CIVIL", confidence: 0.78 },
  { keywords: ["door", "lock", "hinge", "باب"], issue: "Damaged door / lock", categoryKey: "CARPENTRY", confidence: 0.75 },
  { keywords: ["elevator", "lift", "اسانسير"], issue: "Elevator fault", categoryKey: "ELEVATOR", confidence: 0.75 },
  { keywords: ["heater", "boiler", "سخان"], issue: "Water heater fault", categoryKey: "APPLIANCES", confidence: 0.75 },
];

/** Deterministic mock: uses file name + caption cues. Never blocks ticket creation. */
export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  async analyzeImage(input: ImageInput): Promise<ImageAnalysis> {
    const haystack = `${input.fileName.replace(/[_\-.]/g, " ")} ${input.caption ?? ""}`;
    const hint = VISUAL_HINTS.find((h) => findKeywords(haystack, h.keywords).length > 0);
    if (hint) {
      return {
        issue: hint.issue,
        categoryKey: hint.categoryKey,
        confidence: hint.confidence,
        description: `Simulated vision: image appears to show ${hint.issue.toLowerCase()}.`,
        provider: this.name,
      };
    }
    return {
      issue: "Unidentified issue in photo",
      categoryKey: null,
      confidence: 0.3,
      description: "Simulated vision: no recognizable defect; photo stored for the technician.",
      provider: this.name,
    };
  }
}

const VISION_PROMPT = `You inspect photos sent by residents to a building maintenance team.
Return ONE JSON object: {"issue": short English description of the defect, "category": one of ${CATEGORY_CATALOG.map((c) => c.key).join("|")}, "confidence": 0..1, "description": one sentence}.`;

/** Ollama (llava, qwen2.5vl, llama3.2-vision) / OpenAI-compatible vision models */
export class OpenAICompatibleVisionProvider implements VisionProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}
  async analyzeImage(input: ImageInput): Promise<ImageAnalysis> {
    const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
    const res = await fetchJson<{ choices?: { message?: { content?: string } }[] }>(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      timeoutMs: 45000,
      headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${VISION_PROMPT}\nResident caption: ${input.caption ?? "(none)"}` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    return toAnalysis(res.choices?.[0]?.message?.content ?? "", this.name);
  }
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini";
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}
  async analyzeImage(input: ImageInput): Promise<ImageAnalysis> {
    const res = await geminiGenerate(
      this.model,
      this.apiKey,
      {
        contents: [
          {
            role: "user",
            parts: [
              { text: `${VISION_PROMPT}\nResident caption: ${input.caption ?? "(none)"}` },
              { inline_data: { mime_type: input.mimeType, data: input.buffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      },
      45000,
    );
    return toAnalysis(geminiText(res), this.name);
  }
}

function toAnalysis(raw: string, provider: string): ImageAnalysis {
  const j = extractJson(raw) as Record<string, unknown>;
  const category = normalizeCategory(j.category);
  return {
    issue: String(j.issue ?? "Unidentified issue"),
    categoryKey: category === "OTHER" ? null : category,
    confidence: normalizeConfidence(j.confidence),
    description: String(j.description ?? ""),
    provider,
  };
}

let instance: VisionProvider | null = null;
const mock = new MockVisionProvider();

export function getVisionProvider(): VisionProvider {
  if (instance) return instance;
  const c = getConfig();
  switch (c.VISION_PROVIDER) {
    case "ollama":
      instance = new OpenAICompatibleVisionProvider("ollama", c.VISION_BASE_URL || `${c.OLLAMA_BASE_URL}/v1`, c.VISION_MODEL || "llava:7b");
      break;
    case "openai":
      instance = c.VISION_API_KEY
        ? new OpenAICompatibleVisionProvider("openai", c.VISION_BASE_URL || "https://api.openai.com/v1", c.VISION_MODEL || "gpt-4o-mini", c.VISION_API_KEY)
        : mock;
      break;
    case "gemini":
      instance = c.VISION_API_KEY || c.GEMINI_API_KEY ? new GeminiVisionProvider(c.VISION_MODEL && c.VISION_MODEL.startsWith("gemini") ? c.VISION_MODEL : GEMINI_DEFAULT_MODEL, (c.VISION_API_KEY || c.GEMINI_API_KEY)!) : mock;
      break;
    default:
      instance = mock;
  }
  return instance;
}

export function getFallbackVisionProvider(): VisionProvider {
  return mock;
}

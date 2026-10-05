import { postChatCompletion } from "../http";
import { geminiEffectiveModel, geminiGenerate, geminiText } from "../gemini";
import { parseClassificationResponse } from "./parser";
import { CLASSIFY_SYSTEM_PROMPT, buildClassifyUserPrompt, buildReplyPrompt } from "./prompts";
import { renderTemplate } from "./templates";
import { MockAIProvider } from "./mock-ai.provider";
import type {
  AIProvider,
  ExtractedMaintenanceData,
  MaintenanceClassification,
  MaintenanceInput,
  ResponseInput,
} from "./types";

/**
 * Base class for LLM-backed providers. Subclasses only implement `complete()`.
 * Classification output always goes through the strict parser; entity extraction
 * reuses the classification; replies are template-first (optionally LLM-polished).
 */
export abstract class LLMProvider implements AIProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  protected readonly local = new MockAIProvider();

  constructor(
    protected readonly opts: { timeoutMs: number; generateReplies?: boolean },
  ) {}

  protected abstract complete(system: string, user: string, json: boolean): Promise<string>;

  async classifyMaintenanceRequest(input: MaintenanceInput): Promise<MaintenanceClassification> {
    const raw = await this.complete(CLASSIFY_SYSTEM_PROMPT, buildClassifyUserPrompt(input), true);
    const parsed = parseClassificationResponse(raw, input.text);
    if (input.disallowFollowUp) {
      parsed.needsMoreInfo = false;
      parsed.followUpQuestion = null;
    }
    // Never trust an asset code that isn't in the known list
    if (parsed.assetCode && !input.knownAssets?.some((a) => a.assetCode === parsed.assetCode)) parsed.assetCode = null;
    return parsed;
  }

  async extractEntities(input: MaintenanceInput): Promise<ExtractedMaintenanceData> {
    const [c, local] = await Promise.all([this.classifyMaintenanceRequest(input), this.local.extractEntities(input)]);
    return {
      location: c.location ?? local.location,
      room: local.room,
      assetType: c.assetType ?? local.assetType,
      assetCode: c.assetCode ?? local.assetCode,
      symptoms: [c.issue, ...local.symptoms.filter((s) => s !== c.issue)],
      urgencySignals: local.urgencySignals,
      severity: c.severity !== "unknown" ? c.severity : local.severity,
    };
  }

  async generateResponse(input: ResponseInput): Promise<string> {
    const draft = renderTemplate(input);
    if (!this.opts.generateReplies) return draft;
    try {
      const out = (await this.complete("You write short WhatsApp messages.", buildReplyPrompt(input, draft), false)).trim();
      // Guard: the rewritten message must still contain the ticket number
      if (input.data.ticketNumber && !out.includes(String(input.data.ticketNumber))) return draft;
      return out || draft;
    } catch {
      return draft;
    }
  }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Any OpenAI-compatible Chat Completions API:
 *  - Ollama (local, free):   http://localhost:11434/v1
 *  - Groq (free tier):       https://api.groq.com/openai/v1
 *  - OpenRouter (free models): https://openrouter.ai/api/v1
 *  - OpenAI
 */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string | undefined,
    opts: { timeoutMs: number; generateReplies?: boolean },
  ) {
    super(opts);
  }

  protected async complete(system: string, user: string, json: boolean): Promise<string> {
    const res = await postChatCompletion<ChatCompletionResponse>(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        timeoutMs: this.opts.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.name === "openrouter" ? { "HTTP-Referer": "http://localhost:3000", "X-Title": "MaintenanceOS" } : {}),
        },
      },
      {
        model: this.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      },
    );
    const content = res.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name}: empty completion`);
    return content;
  }
}

/** Google Gemini (has a free tier via Google AI Studio keys) */
export class GeminiProvider extends LLMProvider {
  readonly name = "gemini";
  /** Reports the model actually used (Gemini IDs get retired; see ../gemini.ts) */
  get model() {
    return geminiEffectiveModel(this.configuredModel);
  }
  constructor(
    private readonly configuredModel: string,
    private readonly apiKey: string,
    opts: { timeoutMs: number; generateReplies?: boolean },
  ) {
    super(opts);
  }

  protected async complete(system: string, user: string, json: boolean): Promise<string> {
    const res = await geminiGenerate(
      this.configuredModel,
      this.apiKey,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, ...(json ? { responseMimeType: "application/json" } : {}) },
      },
      this.opts.timeoutMs,
    );
    const text = geminiText(res);
    if (!text) throw new Error("gemini: empty completion");
    return text;
  }
}

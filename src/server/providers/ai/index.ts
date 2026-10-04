import { getConfig } from "@/lib/config";
import { GeminiProvider, OpenAICompatibleProvider } from "./llm.provider";
import { MockAIProvider } from "./mock-ai.provider";
import type { AIProvider } from "./types";

export * from "./types";
export { MockAIProvider } from "./mock-ai.provider";

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "qwen2.5:7b",
  groq: "openai/gpt-oss-120b",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

let primary: AIProvider | null = null;
const fallback = new MockAIProvider();

/**
 * Provider factory driven by AI_PROVIDER. Falls back to the mock provider when the
 * selected provider is misconfigured (e.g. missing API key) so the app always boots.
 */
export function getAIProvider(): AIProvider {
  if (primary) return primary;
  const c = getConfig();
  const opts = { timeoutMs: c.AI_TIMEOUT_MS, generateReplies: c.AI_GENERATE_REPLIES };
  const model = c.AI_MODEL || DEFAULT_MODELS[c.AI_PROVIDER];
  switch (c.AI_PROVIDER) {
    case "ollama":
      primary = new OpenAICompatibleProvider("ollama", c.AI_BASE_URL || `${c.OLLAMA_BASE_URL}/v1`, model, undefined, opts);
      break;
    case "groq":
    case "openrouter":
    case "openai":
      primary = c.AI_API_KEY
        ? new OpenAICompatibleProvider(c.AI_PROVIDER, c.AI_BASE_URL || DEFAULT_BASE_URLS[c.AI_PROVIDER], model, c.AI_API_KEY, opts)
        : warnAndMock(`${c.AI_PROVIDER} selected but AI_API_KEY is empty`);
      break;
    case "gemini":
      primary = c.AI_API_KEY || c.GEMINI_API_KEY ? new GeminiProvider(model, (c.AI_API_KEY || c.GEMINI_API_KEY)!, opts) : warnAndMock("gemini selected but AI_API_KEY / GEMINI_API_KEY is empty");
      break;
    default:
      primary = fallback;
  }
  return primary;
}

export function getFallbackAIProvider(): AIProvider {
  return fallback;
}

function warnAndMock(msg: string): AIProvider {
  console.warn(`[ai] ${msg} — using MockAIProvider`);
  return fallback;
}

/** For tests */
export function setAIProvider(p: AIProvider | null) {
  primary = p;
}

import { getAIProvider, getFallbackAIProvider } from "@/server/providers/ai";
import type { MaintenanceClassification, MaintenanceInput, ResponseInput } from "@/server/providers/ai";
import { withRetry } from "@/server/providers/http";
import { renderTemplate } from "@/server/providers/ai/templates";
import { getActiveCategoryCatalog } from "./category-catalog.service";

export interface ClassificationOutcome {
  classification: MaintenanceClassification;
  provider: string;
  model: string | null;
  latencyMs: number;
  fallbackUsed: boolean;
  error: string | null;
}

/**
 * Resilient AI facade used by business logic. Tries the configured provider
 * (with one retry), then falls back to the deterministic MockAIProvider.
 * Business logic never imports a vendor SDK.
 */
export async function classifyRequest(rawInput: MaintenanceInput): Promise<ClassificationOutcome> {
  const input: MaintenanceInput = rawInput.categories ? rawInput : { ...rawInput, categories: await getActiveCategoryCatalog().catch(() => undefined) };
  const primary = getAIProvider();
  const fallback = getFallbackAIProvider();
  const started = Date.now();
  if (primary !== fallback) {
    try {
      const classification = await withRetry(() => primary.classifyMaintenanceRequest(input), 1);
      return { classification, provider: primary.name, model: primary.model ?? null, latencyMs: Date.now() - started, fallbackUsed: false, error: null };
    } catch (e) {
      console.warn(`[ai] ${primary.name} failed, falling back to mock: ${(e as Error).message}`);
      const classification = await fallback.classifyMaintenanceRequest(input);
      return {
        classification,
        provider: fallback.name,
        model: fallback.model ?? null,
        latencyMs: Date.now() - started,
        fallbackUsed: true,
        error: (e as Error).message,
      };
    }
  }
  const classification = await fallback.classifyMaintenanceRequest(input);
  return { classification, provider: fallback.name, model: fallback.model ?? null, latencyMs: Date.now() - started, fallbackUsed: false, error: null };
}

export async function generateReply(input: ResponseInput): Promise<string> {
  try {
    return await getAIProvider().generateResponse(input);
  } catch {
    return renderTemplate(input);
  }
}

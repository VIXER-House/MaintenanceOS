import { fetchJson, ProviderHttpError } from "./http";

/**
 * Shared Gemini (Google AI Studio) client.
 *
 * Google retires model IDs regularly (gemini-2.0/2.5 were shut down in 2026), which
 * shows up as HTTP 404. Default to the auto-updating alias, and if the configured model
 * is gone, look up a current Flash model with ListModels once and use that instead.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const replacement = new Map<string, string>(); // configured model → working model

export interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

function isModelMissing(e: unknown) {
  if (!(e instanceof ProviderHttpError)) return false;
  if (e.status === 404) return true;
  return e.status === 400 && /model|not found|not supported/i.test(e.body ?? "");
}

/** Pick the best current text-capable Flash model this key can use. */
export async function findCurrentFlashModel(apiKey: string): Promise<string | null> {
  const res = await fetchJson<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>(
    `${BASE}/models?pageSize=1000&key=${apiKey}`,
    { timeoutMs: 10000 },
  );
  const ids = (res.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini-/.test(id) && /flash/.test(id) && !/(image|tts|audio|live|embedding|thinking|exp|8b)/.test(id));
  if (!ids.length) return null;
  if (ids.includes(GEMINI_DEFAULT_MODEL)) return GEMINI_DEFAULT_MODEL;
  const version = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const score = (id: string) => version(id) * 100 - (/lite/.test(id) ? 5 : 0) - (/preview/.test(id) ? 2 : 0) - (/-\d{3}$|-\d{2}-\d{4}$/.test(id) ? 1 : 0);
  return ids.sort((a, b) => score(b) - score(a))[0];
}

/** POST :generateContent, transparently switching to a current model if the configured one was retired. */
export async function geminiGenerate(model: string, apiKey: string, body: unknown, timeoutMs: number): Promise<GeminiResponse> {
  const call = (m: string) =>
    fetchJson<GeminiResponse>(`${BASE}/models/${m}:generateContent?key=${apiKey}`, {
      method: "POST",
      timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const effective = replacement.get(model) ?? model;
  try {
    return await call(effective);
  } catch (e) {
    if (!isModelMissing(e)) throw e;
    const next = await findCurrentFlashModel(apiKey).catch(() => null);
    if (!next || next === effective) throw e;
    console.warn(`[gemini] model "${effective}" is unavailable — switching to "${next}"`);
    replacement.set(model, next);
    return call(next);
  }
}

/** The model actually in use (after any automatic replacement). */
export function geminiEffectiveModel(model: string) {
  return replacement.get(model) ?? model;
}

export function geminiText(res: GeminiResponse) {
  return res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

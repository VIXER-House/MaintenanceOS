import { afterEach, describe, expect, it, vi } from "vitest";
import { findCurrentFlashModel, geminiEffectiveModel, geminiGenerate, geminiText } from "@/server/providers/gemini";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MODELS = {
  models: [
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/gemini-3.8-flash-image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.9-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("gemini model fallback", () => {
  it("picks the newest stable text Flash model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, MODELS)));
    expect(await findCurrentFlashModel("k")).toBe("gemini-3.8-flash");
  });

  it("switches to a current model when the configured one returns 404, and remembers it", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url.replace(/\?.*/, ""));
        if (url.includes("/models/gemini-2.5-flash:")) return json(404, { error: { message: "models/gemini-2.5-flash is not found for API version v1beta" } });
        if (url.includes("/models?")) return json(200, MODELS);
        return json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
      }),
    );
    const res = await geminiGenerate("gemini-2.5-flash", "k", { contents: [] }, 5000);
    expect(geminiText(res)).toBe("ok");
    expect(geminiEffectiveModel("gemini-2.5-flash")).toBe("gemini-3.8-flash");
    await geminiGenerate("gemini-2.5-flash", "k", { contents: [] }, 5000);
    expect(calls.filter((c) => c.endsWith("gemini-2.5-flash:generateContent"))).toHaveLength(1);
  });

  it("does not hide other errors (e.g. bad key) and includes Google's reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: { message: "API key not valid" } })));
    await expect(geminiGenerate("gemini-flash-latest", "bad", {}, 5000)).rejects.toThrow("HTTP 403 from generativelanguage.googleapis.com: API key not valid");
  });
});

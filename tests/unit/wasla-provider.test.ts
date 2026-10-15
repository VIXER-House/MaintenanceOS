import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaslaWhatsAppProvider } from "@/server/providers/whatsapp/wasla.provider";

const wasla = new WaslaWhatsAppProvider({ apiUrl: "https://wasla.example.com/", apiKey: "wk_live_x", webhookSecret: "whsec_1" });
afterEach(() => vi.unstubAllGlobals());

describe("Wasla provider", () => {
  it("sends text and templates to /api/v1/messages with the API key", async () => {
    const calls: { url: string; auth: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "wamid.1", status: "sent" }), { status: 200 });
    }));
    expect(await wasla.sendMessage("+201001234567", "hi")).toMatchObject({ provider: "wasla", providerMessageId: "wamid.1", status: "SENT" });
    await wasla.sendTemplate("+201001234567", "job_offer", "ar", ["Ahmed"]);
    expect(calls[0]).toEqual({ url: "https://wasla.example.com/api/v1/messages", auth: "Bearer wk_live_x", body: { to: "+201001234567", text: "hi" } });
    expect(calls[1].body).toEqual({ to: "+201001234567", template: { name: "job_offer", language: "ar", params: ["Ahmed"] } });
  });

  it("reports Wasla's error code (e.g. outside the 24h window, no credits)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "insufficient_credits", message: "Not enough credits" } }), { status: 402 })));
    const r = await wasla.sendMessage("+201001234567", "hi");
    expect(r.status).toBe("FAILED");
    expect(r.error).toContain("insufficient_credits");
  });

  it("parses forwarded messages and checks the signature", async () => {
    const body = JSON.stringify({
      type: "whatsapp.events",
      messages: [
        { from: "+201001234567", providerMessageId: "wamid.A", timestamp: "2026-10-15T09:00:00.000Z", type: "text", text: "الحنفية بتنقط", profileName: "Mona" },
        { from: "+201001234567", providerMessageId: "wamid.B", type: "audio", media: { id: "m1", mimeType: "audio/ogg" } },
      ],
      statuses: [],
    });
    const sig = `sha256=${createHmac("sha256", "whsec_1").update(body).digest("hex")}`;
    expect(wasla.verifySignature(body, sig)).toBe(true);
    expect(wasla.verifySignature(body + " ", sig)).toBe(false);
    expect(wasla.verifySignature(body, null)).toBe(false);
    const msgs = await wasla.receiveMessage(JSON.parse(body));
    expect(msgs[0]).toMatchObject({ from: "+201001234567", providerMessageId: "wasla.wamid.A", text: "الحنفية بتنقط", profileName: "Mona" });
    expect(msgs[1]).toMatchObject({ type: "audio", media: { id: "m1", mimeType: "audio/ogg" } });
  });

  it("downloads media through Wasla", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://wasla.example.com/api/v1/media/m1");
      return new Response(Buffer.from("ogg"), { status: 200 });
    }));
    expect((await wasla.downloadMedia({ id: "m1", mimeType: "audio/ogg" }))?.toString()).toBe("ogg");
  });
});

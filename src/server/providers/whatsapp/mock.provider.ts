import { randomUUID } from "crypto";
import { z } from "zod";
import type { InboundMedia, InboundMessage, SendResult, WhatsAppProvider } from "./types";

/** Wire format posted by the /whatsapp simulator (and usable from curl/Postman). */
export const MockInboundSchema = z.object({
  from: z.string().min(5),
  type: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
  text: z.string().max(4000).optional(),
  profileName: z.string().optional(),
  media: z
    .object({
      base64: z.string().optional(),
      mimeType: z.string(),
      fileName: z.string().optional(),
      caption: z.string().optional(),
      simulatedTranscript: z.string().optional(),
    })
    .optional(),
});
export type MockInboundPayload = z.infer<typeof MockInboundSchema>;

/**
 * Local WhatsApp simulator provider. Outbound messages are "delivered" by being
 * persisted (the messaging service stores every message), which the simulator UI
 * renders as a WhatsApp chat. No network, no credentials.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";

  async sendMessage(to: string, body: string): Promise<SendResult> {
    if (process.env.NODE_ENV !== "test") console.info(`[whatsapp:mock] → ${to}: ${body.split("\n")[0].slice(0, 80)}`);
    return { provider: this.name, providerMessageId: `mock.${randomUUID()}`, status: "SENT" };
  }

  async sendTemplate(to: string, templateName: string, languageCode: string, params: string[]): Promise<SendResult> {
    return this.sendMessage(to, `[template:${templateName}/${languageCode}] ${params.join(" | ")}`);
  }

  async sendMedia(to: string, media: { url: string; mimeType: string; caption?: string }): Promise<SendResult> {
    return this.sendMessage(to, `[media ${media.mimeType}] ${media.caption ?? media.url}`);
  }

  async receiveMessage(payload: unknown): Promise<InboundMessage[]> {
    const p = MockInboundSchema.parse(payload);
    let media: InboundMedia | undefined;
    if (p.media) {
      media = {
        buffer: p.media.base64 ? Buffer.from(p.media.base64.replace(/^data:[^,]+,/, ""), "base64") : Buffer.alloc(0),
        mimeType: p.media.mimeType,
        fileName: p.media.fileName,
        caption: p.media.caption,
        simulatedTranscript: p.media.simulatedTranscript,
      };
    }
    return [
      {
        from: p.from,
        providerMessageId: `sim.${randomUUID()}`,
        timestamp: new Date(),
        type: p.type,
        text: p.text ?? p.media?.caption,
        media,
        profileName: p.profileName,
      },
    ];
  }

  async downloadMedia(media: InboundMedia): Promise<Buffer | null> {
    return media.buffer ?? null;
  }
}

import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { InboundMedia, InboundMessage, SendResult, WhatsAppProvider } from "./types";

/**
 * "Bridge" adapter for the self-hosted WhatsApp-Web bridge (whatsapp-bridge/ folder),
 * which links a WhatsApp account by QR code and runs on a PC.
 *
 * Inbound:  bridge  → POST /api/whatsapp/bridge/inbound   (shared secret)
 * Outbound: app queues messages (status QUEUED); the bridge polls
 *           GET /api/whatsapp/bridge/outbox, sends them and POSTs /ack.
 * Polling means the bridge needs no public URL; when it has one (cloud deploy,
 * WHATSAPP_BRIDGE_URL) the app also pings it so queued messages go out instantly.
 */
export const BridgeInboundSchema = z.object({
  from: z.string().min(5),
  messageId: z.string().min(1),
  type: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
  text: z.string().max(4000).optional(),
  profileName: z.string().optional(),
  timestamp: z.number().optional(),
  media: z.object({ base64: z.string(), mimeType: z.string(), fileName: z.string().optional() }).optional(),
});

export class BridgeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "bridge";

  /** Delivery happens when the bridge picks the message up from the outbox. */
  async sendMessage(): Promise<SendResult> {
    return { provider: this.name, providerMessageId: null, status: "QUEUED" };
  }
  sendTemplate(): Promise<SendResult> {
    return this.sendMessage();
  }
  sendMedia(): Promise<SendResult> {
    return this.sendMessage();
  }

  async receiveMessage(payload: unknown): Promise<InboundMessage[]> {
    const p = BridgeInboundSchema.parse(payload);
    const media: InboundMedia | undefined = p.media
      ? { buffer: Buffer.from(p.media.base64, "base64"), mimeType: p.media.mimeType, fileName: p.media.fileName, caption: p.text }
      : undefined;
    return [
      {
        from: `+${p.from.replace(/[^\d]/g, "")}`,
        providerMessageId: `bridge.${p.messageId}`,
        timestamp: p.timestamp ? new Date(p.timestamp * 1000) : new Date(),
        type: p.type,
        text: p.text,
        media,
        profileName: p.profileName,
      },
    ];
  }

  async downloadMedia(media: InboundMedia): Promise<Buffer | null> {
    return media.buffer ?? null;
  }
}

/**
 * Nudge the cloud bridge to fetch the outbox / heartbeat now. Best effort: if the
 * bridge is asleep or unreachable, it still picks the message up on its next poll.
 */
export async function wakeBridge(): Promise<void> {
  const { WHATSAPP_BRIDGE_URL: url, WHATSAPP_BRIDGE_SECRET: secret } = getConfig();
  if (!url || !secret) return;
  try {
    await fetch(`${url.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { "x-bridge-secret": secret },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* asleep or unreachable — the bridge's periodic poll covers it */
  }
}

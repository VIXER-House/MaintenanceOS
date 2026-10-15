import { createHmac, timingSafeEqual } from "crypto";
import { normalizePhone, type InboundMedia, type InboundMessage, type InboundMessageType, type OutgoingMedia, type SendResult, type WhatsAppProvider } from "@vixer-house/whatsapp-kit";

/**
 * Wasla platform (our own WhatsApp + AI API) as the WhatsApp channel.
 *
 * Outbound: POST {WASLA_API_URL}/api/v1/messages with the account's API key.
 * Inbound:  Wasla forwards incoming messages to /api/whatsapp/wasla, signed with
 *           X-Wasla-Signature (HMAC-SHA256 of the raw body with the webhook signing secret).
 * Media:    GET {WASLA_API_URL}/api/v1/media/{id}
 */
export interface WaslaConfig {
  apiUrl: string;
  apiKey: string;
  webhookSecret?: string;
}

interface WaslaInbound {
  from: string;
  providerMessageId: string;
  timestamp?: string;
  type?: InboundMessageType;
  text?: string;
  profileName?: string;
  replyId?: string;
  media?: { id?: string; mimeType?: string; caption?: string; fileName?: string };
}

export class WaslaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "wasla";
  private readonly base: string;

  constructor(private readonly cfg: WaslaConfig) {
    this.base = cfg.apiUrl.replace(/\/$/, "");
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    try {
      const res = await fetch(`${this.base}/api/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string | null; error?: { code?: string; message?: string } };
      if (!res.ok) return { provider: this.name, providerMessageId: null, status: "FAILED", error: `${json.error?.code ?? res.status}: ${json.error?.message ?? "Wasla API error"}` };
      return { provider: this.name, providerMessageId: json.id ?? null, status: "SENT" };
    } catch (e) {
      return { provider: this.name, providerMessageId: null, status: "FAILED", error: `Wasla unreachable: ${(e as Error).message}` };
    }
  }

  sendMessage(to: string, body: string) {
    return this.post({ to, text: body });
  }

  sendTemplate(to: string, templateName: string, languageCode: string, params: string[]) {
    return this.post({ to, template: { name: templateName, language: languageCode, params } });
  }

  /** The Wasla API sends text only for now — media goes out as a link. */
  sendMedia(to: string, media: OutgoingMedia) {
    return this.post({ to, text: [media.caption, media.url].filter(Boolean).join("\n") });
  }

  /** Body forwarded by Wasla: { type: "whatsapp.events", messages: [...], statuses: [...] } */
  async receiveMessage(payload: unknown): Promise<InboundMessage[]> {
    const p = payload as { messages?: WaslaInbound[] } | null;
    return (p?.messages ?? [])
      .filter((m) => m?.from && m.providerMessageId)
      .map((m) => {
        const media: InboundMedia | undefined = m.media?.id
          ? { id: m.media.id, mimeType: m.media.mimeType ?? "application/octet-stream", caption: m.media.caption, fileName: m.media.fileName }
          : undefined;
        return {
          from: normalizePhone(m.from),
          providerMessageId: `wasla.${m.providerMessageId}`,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          type: m.type ?? "text",
          text: m.text,
          media,
          profileName: m.profileName,
          replyId: m.replyId,
        };
      });
  }

  async downloadMedia(media: InboundMedia): Promise<Buffer | null> {
    if (media.buffer) return media.buffer;
    if (!media.id) return null;
    const res = await fetch(`${this.base}/api/v1/media/${encodeURIComponent(media.id)}`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Wasla media download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** X-Wasla-Signature: sha256=<hex HMAC of the raw body>. */
  verifySignature(rawBody: string, header: string | null): boolean {
    if (!this.cfg.webhookSecret || !header) return false;
    const expected = `sha256=${createHmac("sha256", this.cfg.webhookSecret).update(rawBody).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

import { createHmac, timingSafeEqual } from "crypto";
import { fetchJson } from "../http";
import type { InboundMedia, InboundMessage, InboundMessageType, SendResult, WhatsAppProvider } from "./types";

/**
 * Meta WhatsApp Cloud API adapter.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 * Works with Meta's free developer test number (up to 5 verified recipient numbers).
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  private readonly base: string;

  constructor(
    private readonly cfg: { token: string; phoneNumberId: string; apiVersion: string; appSecret?: string },
  ) {
    this.base = `https://graph.facebook.com/${cfg.apiVersion}`;
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    try {
      const res = await fetchJson<{ messages?: { id: string }[] }>(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
        method: "POST",
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
      });
      return { provider: this.name, providerMessageId: res.messages?.[0]?.id ?? null, status: "SENT" };
    } catch (e) {
      return { provider: this.name, providerMessageId: null, status: "FAILED", error: (e as Error).message };
    }
  }

  private static toWaId(phone: string) {
    return phone.replace(/[^\d]/g, "");
  }

  sendMessage(to: string, body: string) {
    return this.post({ to: MetaWhatsAppProvider.toWaId(to), type: "text", text: { preview_url: false, body } });
  }

  sendTemplate(to: string, templateName: string, languageCode: string, params: string[]) {
    return this.post({
      to: MetaWhatsAppProvider.toWaId(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [],
      },
    });
  }

  sendMedia(to: string, media: { url: string; mimeType: string; caption?: string }) {
    const type = media.mimeType.startsWith("image/") ? "image" : media.mimeType.startsWith("audio/") ? "audio" : media.mimeType.startsWith("video/") ? "video" : "document";
    return this.post({ to: MetaWhatsAppProvider.toWaId(to), type, [type]: { link: media.url, ...(media.caption && type !== "audio" ? { caption: media.caption } : {}) } });
  }

  async receiveMessage(payload: unknown): Promise<InboundMessage[]> {
    const out: InboundMessage[] = [];
    const p = payload as MetaWebhookPayload;
    for (const entry of p?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const contacts = value?.contacts ?? [];
        for (const m of value?.messages ?? []) {
          const type = (["text", "image", "audio", "video", "document"].includes(m.type) ? m.type : "text") as InboundMessageType;
          const mediaObj = m.image ?? m.audio ?? m.video ?? m.document ?? m.voice;
          const media: InboundMedia | undefined = mediaObj
            ? { id: mediaObj.id, mimeType: mediaObj.mime_type ?? "application/octet-stream", caption: mediaObj.caption, fileName: mediaObj.filename }
            : undefined;
          out.push({
            from: `+${m.from}`,
            providerMessageId: m.id,
            timestamp: new Date(Number(m.timestamp) * 1000),
            type,
            text: m.text?.body ?? mediaObj?.caption,
            media,
            profileName: contacts.find((c) => c.wa_id === m.from)?.profile?.name,
          });
        }
      }
    }
    return out;
  }

  async downloadMedia(media: InboundMedia): Promise<Buffer | null> {
    if (!media.id) return null;
    const meta = await fetchJson<{ url: string }>(`${this.base}/${media.id}`, { headers: { Authorization: `Bearer ${this.cfg.token}` } });
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.cfg.token}` } });
    if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Validate X-Hub-Signature-256 (only when WHATSAPP_APP_SECRET is configured) */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.cfg.appSecret) return true;
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.cfg.appSecret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader.slice(7));
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

interface MetaMediaObj {
  id: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}
interface MetaWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: MetaMediaObj;
          audio?: MetaMediaObj;
          voice?: MetaMediaObj;
          video?: MetaMediaObj;
          document?: MetaMediaObj;
        }[];
      };
    }[];
  }[];
}

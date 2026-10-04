import { createHmac, timingSafeEqual } from "crypto";
import { fetchJson } from "../http";
import type { InboundMedia, InboundMessage, InboundMessageType, SendResult, WhatsAppProvider } from "./types";

/**
 * Twilio WhatsApp adapter — works with the free Twilio WhatsApp Sandbox:
 * no Meta app, no business verification, testers just send "join <code>".
 * Docs: https://www.twilio.com/docs/whatsapp/sandbox
 */
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";

  constructor(
    private readonly cfg: { accountSid: string; authToken: string; from: string },
  ) {}

  private get auth() {
    return `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`;
  }

  private static wa(phone: string) {
    return `whatsapp:+${phone.replace(/[^\d]/g, "")}`;
  }

  private async send(params: Record<string, string>): Promise<SendResult> {
    try {
      const res = await fetchJson<{ sid?: string }>(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
        method: "POST",
        timeoutMs: 15000,
        headers: { Authorization: this.auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: TwilioWhatsAppProvider.wa(this.cfg.from), ...params }).toString(),
      });
      return { provider: this.name, providerMessageId: res.sid ?? null, status: "SENT" };
    } catch (e) {
      return { provider: this.name, providerMessageId: null, status: "FAILED", error: (e as Error).message };
    }
  }

  sendMessage(to: string, body: string) {
    // WhatsApp-via-Twilio bodies are limited to 1600 characters
    return this.send({ To: TwilioWhatsAppProvider.wa(to), Body: body.slice(0, 1600) });
  }

  sendTemplate(to: string, templateName: string, _languageCode: string, params: string[]) {
    return this.sendMessage(to, `${templateName}: ${params.join(" · ")}`);
  }

  sendMedia(to: string, media: { url: string; mimeType: string; caption?: string }) {
    return this.send({ To: TwilioWhatsAppProvider.wa(to), MediaUrl: media.url, ...(media.caption ? { Body: media.caption } : {}) });
  }

  /** Twilio posts application/x-www-form-urlencoded fields; pass them as a plain object. */
  async receiveMessage(payload: unknown): Promise<InboundMessage[]> {
    const p = payload as Record<string, string>;
    if (!p?.From || !p.MessageSid) return [];
    const numMedia = Number(p.NumMedia ?? 0);
    let media: InboundMedia | undefined;
    let type: InboundMessageType = "text";
    if (numMedia > 0 && p.MediaUrl0) {
      const mime = p.MediaContentType0 ?? "application/octet-stream";
      type = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "document";
      media = { id: p.MediaUrl0, mimeType: mime, caption: p.Body || undefined };
    }
    return [
      {
        from: `+${p.From.replace(/[^\d]/g, "")}`,
        providerMessageId: p.MessageSid,
        timestamp: new Date(),
        type,
        text: p.Body || undefined,
        media,
        profileName: p.ProfileName,
      },
    ];
  }

  async downloadMedia(media: InboundMedia): Promise<Buffer | null> {
    if (!media.id) return null;
    const res = await fetch(media.id, { headers: { Authorization: this.auth }, redirect: "follow" });
    if (!res.ok) throw new Error(`Twilio media download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** X-Twilio-Signature check: HMAC-SHA1(authToken, url + sorted key/value pairs), base64. */
  verifySignature(url: string, params: Record<string, string>, signature: string | null): boolean {
    if (!signature) return false;
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = createHmac("sha1", this.cfg.authToken).update(data).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

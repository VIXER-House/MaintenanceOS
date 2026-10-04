export type InboundMessageType = "text" | "image" | "audio" | "video" | "document";

export interface InboundMedia {
  /** Provider media id (Meta) */
  id?: string;
  /** Inline content (simulator) */
  buffer?: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
  /** Simulator-only: what a simulated voice note says */
  simulatedTranscript?: string;
}

/** Provider-agnostic inbound message — business logic only ever sees this shape. */
export interface InboundMessage {
  from: string;
  providerMessageId: string;
  timestamp: Date;
  type: InboundMessageType;
  text?: string;
  media?: InboundMedia;
  profileName?: string;
}

export interface SendResult {
  provider: string;
  providerMessageId: string | null;
  status: "SENT" | "QUEUED" | "FAILED";
  error?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendMessage(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, templateName: string, languageCode: string, params: string[]): Promise<SendResult>;
  sendMedia(to: string, media: { url: string; mimeType: string; caption?: string }): Promise<SendResult>;
  /** Normalize a raw webhook payload into zero or more inbound messages */
  receiveMessage(payload: unknown): Promise<InboundMessage[]>;
  /** Fetch media bytes for an inbound message (no-op for inline simulator media) */
  downloadMedia(media: InboundMedia): Promise<Buffer | null>;
}

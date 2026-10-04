import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import type { Channel, Role } from "@prisma/client";

export interface NotificationMessage {
  userId: string;
  role?: Role | null;
  title: string;
  body: string;
  link?: string | null;
  ticketId?: string | null;
  /** Contact details for external channels */
  phone?: string | null;
  email?: string | null;
}

export interface NotificationResult {
  channel: Channel;
  provider: string;
  status: "SENT" | "FAILED";
  error?: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: Channel;
  send(msg: NotificationMessage): Promise<NotificationResult>;
}

/**
 * MockNotificationProvider — records the notification in the in-app notification
 * center, tagged with the channel it simulates (IN_APP / WHATSAPP / SMS / EMAIL).
 * Swap for Twilio/SES/FCM implementations of the same interface in production.
 */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";
  constructor(readonly channel: Channel) {}

  async send(msg: NotificationMessage): Promise<NotificationResult> {
    try {
      if (this.channel !== "IN_APP" && process.env.NODE_ENV !== "test") {
        const to = this.channel === "EMAIL" ? msg.email : msg.phone;
        console.info(`[notify:${this.channel.toLowerCase()}:mock] → ${to ?? msg.userId}: ${msg.title}`);
      }
      await db.notification.create({
        data: {
          userId: msg.userId,
          role: msg.role ?? null,
          channel: this.channel,
          provider: this.name,
          title: msg.title,
          body: msg.body,
          link: msg.link ?? null,
          ticketId: msg.ticketId ?? null,
          status: "SENT",
        },
      });
      return { channel: this.channel, provider: this.name, status: "SENT" };
    } catch (e) {
      return { channel: this.channel, provider: this.name, status: "FAILED", error: (e as Error).message };
    }
  }
}

const CHANNEL_MAP: Record<string, Channel> = { in_app: "IN_APP", whatsapp: "WHATSAPP", sms: "SMS", email: "EMAIL" };

let providers: NotificationProvider[] | null = null;

/** Configured staff-notification channels (NOTIFICATION_CHANNELS=in_app,whatsapp,sms,email) */
export function getNotificationProviders(): NotificationProvider[] {
  if (providers) return providers;
  const channels = getConfig()
    .NOTIFICATION_CHANNELS.split(",")
    .map((s) => CHANNEL_MAP[s.trim().toLowerCase()])
    .filter(Boolean);
  if (!channels.includes("IN_APP")) channels.unshift("IN_APP");
  providers = [...new Set(channels)].map((c) => new MockNotificationProvider(c));
  return providers;
}

import type { ActorType, Conversation, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMockWhatsAppProvider, getWhatsAppProvider, type WhatsAppProvider } from "@/server/providers/whatsapp";
import type { ResponseInput } from "@/server/providers/ai";
import { generateReply } from "./ai.service";

export interface ConversationContext {
  provider?: string;
  questionsAsked?: number;
  pendingQuestion?: string | null;
  /** First request from an unregistered number, filed once the unit is known */
  pendingRequest?: string | null;
  [k: string]: unknown;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `+${digits}`;
}

export async function getOrCreateConversation(residentId: string, phone: string): Promise<Conversation> {
  return db.conversation.upsert({
    where: { residentId_channel: { residentId, channel: "WHATSAPP" } },
    update: {},
    create: { residentId, phone: normalizePhone(phone), channel: "WHATSAPP" },
  });
}

export function ctx(c: Conversation): ConversationContext {
  return (c.context ?? {}) as ConversationContext;
}

export async function updateConversation(
  id: string,
  data: { state?: Conversation["state"]; activeTicketId?: string | null; context?: ConversationContext },
) {
  return db.conversation.update({
    where: { id },
    data: {
      state: data.state,
      activeTicketId: data.activeTicketId === undefined ? undefined : data.activeTicketId,
      context: data.context as Prisma.InputJsonValue | undefined,
      lastMessageAt: new Date(),
    },
  });
}

/** Residents who wrote via the simulator are answered by the mock provider; real numbers via the configured provider. */
function providerFor(conversation: Conversation): WhatsAppProvider {
  const p = ctx(conversation).provider;
  return p && p !== "mock" && p === getWhatsAppProvider().name ? getWhatsAppProvider() : getMockWhatsAppProvider();
}

/**
 * Send a WhatsApp message to a resident and persist it (OUTBOUND). Delivery failures
 * are recorded on the message — they never break the business workflow.
 */
export async function sendToResident(
  residentId: string,
  body: string,
  opts: { ticketId?: string | null; senderType?: ActorType; senderName?: string } = {},
) {
  const resident = await db.resident.findUnique({ where: { id: residentId } });
  if (!resident) return null;
  const conversation = await getOrCreateConversation(resident.id, resident.phone);
  const provider = providerFor(conversation);
  let result: Awaited<ReturnType<WhatsAppProvider["sendMessage"]>>;
  try {
    result = await provider.sendMessage(resident.phone, body);
  } catch (e) {
    result = { provider: provider.name, providerMessageId: null, status: "FAILED", error: (e as Error).message };
  }
  const msg = await db.ticketMessage.create({
    data: {
      conversationId: conversation.id,
      ticketId: opts.ticketId ?? null,
      direction: "OUTBOUND",
      channel: "WHATSAPP",
      senderType: opts.senderType ?? "AI",
      senderName: opts.senderName ?? "MaintenanceOS",
      body,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      status: result.status === "FAILED" ? "FAILED" : "SENT",
      error: result.error ?? null,
    },
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  return msg;
}

/** Render (template or LLM-polished) and send a status update to the resident. */
export async function sendResidentUpdate(
  residentId: string | null | undefined,
  kind: ResponseInput["kind"],
  data: ResponseInput["data"],
  ticketId?: string | null,
) {
  if (!residentId) return null;
  const resident = await db.resident.findUnique({ where: { id: residentId }, select: { language: true } });
  if (!resident) return null;
  const language = resident.language === "en" ? "en" : "ar";
  const body = await generateReply({ kind, language, data });
  return sendToResident(residentId, body, { ticketId });
}

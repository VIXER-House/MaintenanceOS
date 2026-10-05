import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { matchKeyword, normalizeArabic, detectLanguage } from "@/lib/arabic";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import { PRIORITY_LABELS, formatMinutesHuman } from "@/server/domain/labels";
import type { InboundMessage } from "@/server/providers/whatsapp";
import { getMockWhatsAppProvider, getWhatsAppProvider } from "@/server/providers/whatsapp";
import { getFallbackSpeechProvider, getSpeechProvider } from "@/server/providers/speech";
import { getFallbackVisionProvider, getVisionProvider, type ImageAnalysis } from "@/server/providers/vision";
import type { Actor } from "./actor";
import { classifyRequest } from "./ai.service";
import { generateReply } from "./ai.service";
import { notifyRoles } from "./notification.service";
import { ctx, getOrCreateConversation, normalizePhone, sendToResident, updateConversation } from "./messaging.service";
import { attachmentTypeFor, saveFile } from "./storage.service";
import {
  createAndTriageTicket,
  getTicketOrThrow,
  handleFollowUpAnswer,
  residentConfirmation,
  residentFacingSummary,
  statusLine,
} from "./ticket.service";
import { loadSlaPolicies } from "./sla.service";

export type IntakeAction =
  | "created"
  | "follow_up_requested"
  | "follow_up_answered"
  | "status"
  | "greeting"
  | "confirmed"
  | "reopened"
  | "unknown_number"
  | "not_understood"
  | "voice_failed"
  | "registration_requested"
  | "registered"
  | "duplicate";

export interface IntakeResult {
  action: IntakeAction;
  residentId?: string;
  conversationId?: string;
  ticketId?: string;
  ticketNumber?: string;
  replies: string[];
}

const YES = ["تمام", "اه", "ايوه", "ايوة", "نعم", "اتحلت", "اتصلحت", "تمت", "شكرا", "الحمد لله", "yes", "ok", "okay", "fixed", "done", "resolved", "thanks"];
const NO = ["لسه", "لا", "مش", "متصلحتش", "مازالت", "no", "not", "still", "broken"];
const STATUS = ["حاله الطلب", "حاله", "الحاله", "متابعه", "status", "track"];

function isNo(text: string) {
  const n = normalizeArabic(text);
  return NO.some((k) => matchKeyword(n, k));
}
function isYes(text: string) {
  const n = normalizeArabic(text);
  return YES.some((k) => matchKeyword(n, k));
}
function isStatusQuery(text: string) {
  const n = normalizeArabic(text);
  return /maint-?\d+/i.test(text) || (n.split(" ").length <= 4 && STATUS.some((k) => matchKeyword(n, k)));
}

/**
 * WhatsApp intake orchestrator. Provider-agnostic: receives a normalized
 * InboundMessage (from the simulator or Meta webhook) and drives the
 * conversation state machine:
 *
 *   IDLE ──request──▶ ticket created ──(missing info)──▶ AWAITING_INFO ──answer──▶ triaged/assigned ──▶ IDLE
 *   ticket completed ──▶ AWAITING_CONFIRMATION ──"تمام"/"لسه"──▶ confirmed / reopened
 */
export async function handleInboundMessage(msg: InboundMessage, providerName: string): Promise<IntakeResult> {
  // Idempotency: Meta retries webhooks
  if (msg.providerMessageId) {
    const dup = await db.ticketMessage.findFirst({ where: { providerMessageId: msg.providerMessageId, direction: "INBOUND" } });
    if (dup) return { action: "duplicate", replies: [] };
  }

  const phone = normalizePhone(msg.from);
  const residentInclude = { unit: { include: { building: { include: { compound: true } } } } } as const;
  let resident = await db.resident.findFirst({ where: { phone }, include: residentInclude });

  // Unknown number → create an unverified resident and start self-registration
  if (!resident) {
    const fallbackName = msg.profileName?.trim() || `WhatsApp ${phone.slice(-4)}`;
    resident = await db.resident.create({
      data: { phone, name: fallbackName, nameAr: fallbackName, verified: false, language: detectLanguage(msg.text ?? "") },
      include: residentInclude,
    });
  }

  let conversation = await getOrCreateConversation(resident.id, phone);
  const context = { ...ctx(conversation), provider: providerName };
  conversation = await updateConversation(conversation.id, { context });
  const lang: "ar" | "en" = resident.language === "en" ? "en" : "ar";
  const residentActor: Actor = { type: "RESIDENT", name: resident.nameAr ?? resident.name, residentId: resident.id, userId: resident.userId };

  // Persist the inbound message
  const inbound = await db.ticketMessage.create({
    data: {
      conversationId: conversation.id,
      ticketId: conversation.activeTicketId,
      direction: "INBOUND",
      channel: "WHATSAPP",
      senderType: "RESIDENT",
      senderName: resident.nameAr ?? resident.name,
      body: msg.text ?? "",
      mediaType: msg.media ? attachmentTypeFor(msg.media.mimeType) : null,
      provider: providerName,
      providerMessageId: msg.providerMessageId,
      status: "RECEIVED",
      createdAt: msg.timestamp,
    },
  });

  // Media: store, transcribe voice notes, analyze images
  const attachmentIds: string[] = [];
  const imageFindings: ImageAnalysis[] = [];
  let transcript: string | null = null;
  if (msg.media) {
    const provider = providerName !== "mock" ? getWhatsAppProvider() : getMockWhatsAppProvider();
    let buffer: Buffer | null = null;
    try {
      buffer = await provider.downloadMedia(msg.media);
    } catch (e) {
      console.warn("[intake] media download failed", (e as Error).message);
    }
    buffer = buffer ?? Buffer.alloc(0);
    const stored = await saveFile(buffer, msg.media.fileName, msg.media.mimeType);
    const type = attachmentTypeFor(msg.media.mimeType);
    let analysis: Prisma.InputJsonValue | undefined;

    if (type === "AUDIO") {
      transcript = await transcribe(buffer, msg.media.fileName ?? stored.fileName, msg.media.mimeType, msg.media.simulatedTranscript);
      if (transcript) {
        analysis = { transcript };
        await db.ticketMessage.update({ where: { id: inbound.id }, data: { transcript } });
      }
    } else if (type === "IMAGE") {
      const finding = await analyzeImage(buffer, msg.media.mimeType, msg.media.fileName ?? stored.fileName, msg.media.caption ?? msg.text);
      if (finding) {
        imageFindings.push(finding);
        analysis = finding as unknown as Prisma.InputJsonValue;
      }
    }
    const att = await db.ticketAttachment.create({
      data: {
        messageId: inbound.id,
        ticketId: conversation.activeTicketId,
        type,
        url: stored.url,
        fileName: stored.fileName,
        mimeType: msg.media.mimeType,
        size: stored.size,
        analysis,
      },
    });
    attachmentIds.push(att.id);
    await db.ticketMessage.update({ where: { id: inbound.id }, data: { mediaUrl: stored.url } });

    if (type === "AUDIO" && !transcript && !msg.text) {
      const body = await generateReply({ kind: "voice_failed", language: lang, data: {} });
      await sendToResident(resident.id, body);
      return { action: "voice_failed", residentId: resident.id, conversationId: conversation.id, replies: [body] };
    }
  }

  let text = [msg.text, transcript].filter(Boolean).join("\n").trim();
  const reply = async (body: string, ticketId?: string | null) => {
    await sendToResident(resident!.id, body, { ticketId });
    return body;
  };

  // ── 0. Self-registration: we don't know this resident's unit yet
  if (!resident.unitId) {
    const match = text.match(/\b([a-z]\d{2})\s*[-–_ ]?\s*(\d{3})\b/i);
    const unit = match ? await db.unit.findUnique({ where: { code: `${match[1].toUpperCase()}-${match[2]}` } }) : null;
    const remaining = match ? text.replace(match[0], "").replace(/^[\s,.:\-–]+|[\s,.:\-–]+$/g, "") : text;
    const pending = (context.pendingRequest as string | undefined) ?? null;

    if (!unit) {
      // Remember the first real request so we can file it once we know the unit
      const keep = pending ?? (remaining.length >= 3 ? remaining : null);
      await updateConversation(conversation.id, { state: "AWAITING_REGISTRATION", context: { ...context, pendingRequest: keep } });
      const kind = match ? "registration_unit_not_found" : "registration_needed";
      const body = await generateReply({ kind, language: lang, data: { unit: match?.[0] ?? null } });
      await reply(body);
      return { action: "registration_requested", residentId: resident.id, conversationId: conversation.id, replies: [body] };
    }

    resident = await db.resident.update({ where: { id: resident.id }, data: { unitId: unit.id }, include: residentInclude });
    await notifyRoles(["MAINTENANCE_MANAGER", "COMPOUND_MANAGER"], {
      title: `New resident self-registered: ${unit.code}`,
      body: `${resident.name} (${phone}) registered on WhatsApp for unit ${unit.code} — please verify.`,
      link: `/residents`,
    });
    const welcome = await generateReply({ kind: "registration_done", language: lang, data: { unit: unit.code } });
    await reply(welcome);
    await updateConversation(conversation.id, { state: "IDLE", context: { ...context, pendingRequest: null } });
    conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    // Continue with the request: the remainder of this message, or the one they sent first
    text = remaining.length >= 3 ? remaining : pending ?? "";
    if (!text && !attachmentIds.length) {
      return { action: "registered", residentId: resident.id, conversationId: conversation.id, replies: [welcome] };
    }
  }
  const unitInfo = resident.unit!;

  // ── 1. Answer to a pending follow-up question
  if (conversation.state === "AWAITING_INFO" && conversation.activeTicketId) {
    const active = await db.ticket.findUnique({ where: { id: conversation.activeTicketId } });
    if (active?.status === "WAITING_FOR_INFO" && text) {
      if (attachmentIds.length) await db.ticketAttachment.updateMany({ where: { id: { in: attachmentIds } }, data: { ticketId: active.id } });
      const r = await handleFollowUpAnswer(active.id, text, residentActor, inbound.id);
      await updateConversation(conversation.id, { state: "IDLE", activeTicketId: null, context: { ...context, pendingQuestion: null } });
      const cat = r.ticket.category ? CATEGORY_BY_KEY[r.ticket.category.key] : null;
      const body = await generateReply({
        kind: "info_received",
        language: lang,
        data: {
          escalated: r.escalated ? 1 : 0,
          priority: PRIORITY_LABELS[r.ticket.priority][lang],
          action: cat ? (lang === "ar" ? cat.recommendedActionAr : cat.recommendedActionEn.toLowerCase()) : null,
          ticketNumber: r.ticket.ticketNumber,
          sla: formatMinutesHuman(r.sla.responseMinutes, lang),
          technician: r.ticket.technician ? (lang === "ar" ? r.ticket.technician.nameAr ?? r.ticket.technician.name : r.ticket.technician.name) : null,
        },
      });
      await reply(body, r.ticket.id);
      return { action: "follow_up_answered", residentId: resident.id, conversationId: conversation.id, ticketId: r.ticket.id, ticketNumber: r.ticket.ticketNumber, replies: [body] };
    }
    await updateConversation(conversation.id, { state: "IDLE", activeTicketId: null });
  }

  // ── 2. Confirmation of a completed job
  if (conversation.state === "AWAITING_CONFIRMATION" && conversation.activeTicketId && text) {
    const active = await getTicketOrThrow(conversation.activeTicketId);
    if (active.status === "COMPLETED" && (isNo(text) || isYes(text))) {
      await db.ticketMessage.update({ where: { id: inbound.id }, data: { ticketId: active.id } });
      const confirmed = !isNo(text);
      await residentConfirmation(active.id, confirmed, residentActor);
      await updateConversation(conversation.id, { state: "IDLE", activeTicketId: null });
      const body = await generateReply({ kind: confirmed ? "confirmation_thanks" : "reopened", language: lang, data: { ticketNumber: active.ticketNumber } });
      await reply(body, active.id);
      return { action: confirmed ? "confirmed" : "reopened", residentId: resident.id, conversationId: conversation.id, ticketId: active.id, ticketNumber: active.ticketNumber, replies: [body] };
    }
    await updateConversation(conversation.id, { state: "IDLE", activeTicketId: null });
  }

  // ── 3. Status query
  if (text && isStatusQuery(text) && !attachmentIds.length) {
    const numberMatch = text.match(/maint-?(\d+)/i);
    const tickets = await db.ticket.findMany({
      where: {
        residentId: resident.id,
        ...(numberMatch ? { number: Number(numberMatch[1]) } : { status: { in: OPEN_STATUSES } }),
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { technician: true, contractor: true },
    });
    const replies: string[] = [];
    if (!tickets.length) {
      replies.push(await reply(await generateReply({ kind: "no_open_tickets", language: lang, data: {} })));
    } else {
      const lines = await Promise.all(
        tickets.map(async (t) => generateReply({ kind: "status", language: lang, data: statusLine(await getTicketOrThrow(t.id), lang) })),
      );
      replies.push(await reply(lines.join("\n\n"), tickets[0].id));
    }
    return { action: "status", residentId: resident.id, conversationId: conversation.id, replies };
  }

  // ── 4. New maintenance request
  const requestText = text || imageFindings.map((f) => f.issue).join(", ");
  const knownAssets = await db.asset.findMany({
    where: { OR: [{ unitId: resident.unitId }, { buildingId: unitInfo.buildingId, unitId: null }] },
    select: { assetCode: true, name: true, type: true, location: true },
  });
  const outcome = await classifyRequest({
    text: requestText,
    language: detectLanguage(requestText) === "en" && lang === "en" ? "en" : lang,
    imageFindings: imageFindings.map((f) => ({ issue: f.issue, categoryKey: f.categoryKey, confidence: f.confidence })),
    knownAssets,
  });

  if (!outcome.classification.isMaintenanceRequest || !requestText) {
    const body = await generateReply({
      kind: requestText ? "greeting" : "not_understood",
      language: lang,
      data: { name: resident.verified || !(resident.name ?? "").startsWith("WhatsApp ") ? (lang === "ar" ? resident.nameAr : resident.name)?.split(" ")[0] : undefined, compound: lang === "ar" ? unitInfo.building.compound.nameAr ?? unitInfo.building.compound.name : unitInfo.building.compound.name },
    });
    await reply(body);
    return { action: requestText ? "greeting" : "not_understood", residentId: resident.id, conversationId: conversation.id, replies: [body] };
  }

  const triage = await createAndTriageTicket({
    text: requestText,
    source: "WHATSAPP",
    residentId: resident.id,
    unitId: unitInfo.id,
    compoundId: unitInfo.building.compoundId,
    actor: residentActor,
    outcome,
    imageFindings,
    attachmentIds,
    messageId: inbound.id,
  });
  const t = triage.ticket;

  if (triage.needsMoreInfo) {
    await updateConversation(conversation.id, {
      state: "AWAITING_INFO",
      activeTicketId: t.id,
      context: { ...context, questionsAsked: (context.questionsAsked ?? 0) + 1, pendingQuestion: triage.followUpQuestion },
    });
    const body = await generateReply({ kind: "need_info", language: lang, data: { ticketNumber: t.ticketNumber, question: triage.followUpQuestion } });
    await reply(body, t.id);
    return { action: "follow_up_requested", residentId: resident.id, conversationId: conversation.id, ticketId: t.id, ticketNumber: t.ticketNumber, replies: [body] };
  }

  const policies = await loadSlaPolicies();
  const summary = residentFacingSummary(t, lang, policies[t.priority].responseMinutes, lang === "ar" ? outcome.classification.issueAr : outcome.classification.issue);
  const body = await generateReply({ kind: "ticket_created", language: lang, data: summary });
  await reply(body, t.id);
  return { action: "created", residentId: resident.id, conversationId: conversation.id, ticketId: t.id, ticketNumber: t.ticketNumber, replies: [body] };
}

/** Speech-to-text with graceful fallback (configured provider → mock → null). */
async function transcribe(buffer: Buffer, fileName: string, mimeType: string, simulatedTranscript?: string): Promise<string | null> {
  const primary = getSpeechProvider();
  try {
    return (await primary.transcribe({ buffer, fileName, mimeType, simulatedTranscript })).text;
  } catch (e) {
    console.warn(`[speech] ${primary.name} failed: ${(e as Error).message}`);
    if (primary === getFallbackSpeechProvider()) return null;
    try {
      return (await getFallbackSpeechProvider().transcribe({ buffer, fileName, mimeType, simulatedTranscript })).text;
    } catch {
      return null;
    }
  }
}

/** Vision analysis with graceful fallback. Image analysis is never required for ticket creation. */
async function analyzeImage(buffer: Buffer, mimeType: string, fileName: string, caption?: string | null): Promise<ImageAnalysis | null> {
  const primary = getVisionProvider();
  try {
    return await primary.analyzeImage({ buffer, mimeType, fileName, caption });
  } catch (e) {
    console.warn(`[vision] ${primary.name} failed: ${(e as Error).message}`);
    try {
      return await getFallbackVisionProvider().analyzeImage({ buffer, mimeType, fileName, caption });
    } catch {
      return null;
    }
  }
}

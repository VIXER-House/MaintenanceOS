import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { matchKeyword, normalizeArabic, detectLanguage } from "@/lib/arabic";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import { PRIORITY_LABELS, formatMinutesHuman } from "@/server/domain/labels";
import type { InboundMessage } from "@/server/providers/whatsapp";
import { getMockWhatsAppProvider, getWhatsAppProvider } from "@/server/providers/whatsapp";
import { getFallbackSpeechProvider, getMockSpeechProvider, getSpeechProvider } from "@/server/providers/speech";
import { getFallbackVisionProvider, getVisionProvider, type ImageAnalysis } from "@/server/providers/vision";
import type { Actor } from "./actor";
import { classifyRequest } from "./ai.service";
import { generateReply } from "./ai.service";
import { notifyRoles } from "./notification.service";
import { recordEvent } from "./event.service";
import { hasMaintenanceVocabulary } from "@/server/providers/ai/mock-ai.provider";
import { isDifferentIssueAnswer, isSameIssueAnswer, mentionsDistinctIssue } from "@/server/domain/answers";
import { evaluatePriority } from "@/server/engines/priority/priority-engine";
import { findUnitInText, guessUnitAttempt } from "@/server/domain/unit-codes";
import { getGlobalPriorityRules } from "./settings.service";
import type { PriorityRule } from "@/server/domain/categories";
import type { Priority } from "@/server/domain/constants";
import type { TicketStatus } from "@/server/domain/constants";
import { ctx, getOrCreateConversation, normalizePhone, sendToResident, updateConversation } from "./messaging.service";
import { attachmentTypeFor, saveFile } from "./storage.service";
import {
  addIssueToTicket,
  findOpenTicketOfSameType,
  MERGEABLE_STATUSES,
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
  | "duplicate"
  | "comment"
  | "duplicate_check"
  | "duplicate_same"
  | "issue_added";

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
/** A message without a new problem within this window is treated as a comment on the latest open request. */
const RECENT_TICKET_MS = 12 * 60 * 60 * 1000;
const STATUS = ["حاله الطلب", "حاله", "الحاله", "متابعه", "status", "track"];

function isNo(text: string) {
  const n = normalizeArabic(text);
  return NO.some((k) => matchKeyword(n, k));
}
function isYes(text: string) {
  const n = normalizeArabic(text);
  return YES.some((k) => matchKeyword(n, k));
}
/** "لا" / "no" with nothing else */
function isNegativeOnly(text: string) {
  return normalizeArabic(text).split(" ").filter(Boolean).length <= 2 && isNo(text);
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
export async function handleInboundMessage(msg: InboundMessage, providerName: string, opts: { skipDuplicateCheck?: boolean } = {}): Promise<IntakeResult> {
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
      transcript = await transcribe(buffer, msg.media.fileName ?? stored.fileName, msg.media.mimeType, msg.media.simulatedTranscript, providerName === "mock");
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

  /** Same problem reported again → note on the existing ticket, no new ticket. */
  const commentOn = async (ticketId: string, comment: string, messageIds: (string | null | undefined)[], kind: "duplicate_same" | "comment_received") => {
    await db.ticketMessage.updateMany({ where: { id: { in: messageIds.filter(Boolean) as string[] } }, data: { ticketId } });
    const full = await getTicketOrThrow(ticketId);
    await recordEvent(ticketId, "NOTE_ADDED", residentActor, `Resident: "${comment.slice(0, 300)}"`);
    await notifyRoles(["MAINTENANCE_MANAGER"], { title: `Resident follow-up on ${full.ticketNumber}`, body: comment.slice(0, 200), link: `/tickets/${ticketId}`, ticketId });
    const body = await generateReply({ kind, language: lang, data: { ...statusLine(full, lang), priority: PRIORITY_LABELS[full.priority][lang] } });
    await reply(body, ticketId);
    return { body, full };
  };
  /** A different problem of the same type → added to the existing ticket. */
  const addIssue = async (ticketId: string, input: Parameters<typeof addIssueToTicket>[1], extraMessageIds: string[] = []) => {
    const r = await addIssueToTicket(ticketId, input, residentActor);
    if (extraMessageIds.length) await db.ticketMessage.updateMany({ where: { id: { in: extraMessageIds } }, data: { ticketId } });
    const policies = await loadSlaPolicies();
    const body = await generateReply({
      kind: "issue_added",
      language: lang,
      data: {
        ticketNumber: r.ticket.ticketNumber,
        issue: input.issue ?? null,
        technician: statusLine(r.ticket, lang).technician,
        escalated: r.escalated ? 1 : 0,
        priority: PRIORITY_LABELS[r.ticket.priority][lang],
        sla: formatMinutesHuman(r.sla?.responseMinutes ?? policies[r.ticket.priority].responseMinutes, lang),
      },
    });
    await reply(body, ticketId);
    return { action: "issue_added" as const, residentId: resident!.id, conversationId: conversation.id, ticketId, ticketNumber: r.ticket.ticketNumber, replies: [body] };
  };
  const askSameOrDifferent = async (existing: Awaited<ReturnType<typeof getTicketOrThrow>>) => {
    const analysis = lang === "ar" ? await db.aIAnalysis.findFirst({ where: { ticketId: existing.id }, orderBy: { createdAt: "asc" }, select: { entities: true } }) : null;
    const issueAr = (analysis?.entities as { issueAr?: string } | null)?.issueAr;
    const body = await generateReply({
      kind: "duplicate_found",
      language: lang,
      data: {
        ...statusLine(existing, lang),
        category: existing.category ? (lang === "ar" ? existing.category.nameAr : existing.category.nameEn) : "",
        issue: issueAr || existing.title,
      },
    });
    await reply(body, existing.id);
    return body;
  };

  // ── 0. Self-registration: we don't know this resident's unit yet
  if (!resident.unitId) {
    const units = await db.unit.findMany({ select: { id: true, code: true } });
    const found = findUnitInText(text, units);
    const unit = found ? await db.unit.findUnique({ where: { id: found.unit.id } }) : null;
    const attempt = found ? null : guessUnitAttempt(text);
    const remaining = (found ? text.replace(found.matched, "") : text).replace(/^[\s,.:\-–]+|[\s,.:\-–]+$/g, "");
    const example = units[0]?.code ?? "A01-101";
    const pending = (context.pendingRequest as string | undefined) ?? null;

    if (!unit) {
      // Remember the first real request so we can file it once we know the unit
      const keep = pending ?? (remaining.length >= 3 ? remaining : null);
      await updateConversation(conversation.id, { state: "AWAITING_REGISTRATION", context: { ...context, pendingRequest: keep } });
      const kind = attempt ? "registration_unit_not_found" : "registration_needed";
      const body = await generateReply({ kind, language: lang, data: { unit: attempt, example } });
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

  // ── 0b. Answer to "same problem or a different one?" (open ticket of the same type)
  const dup = context.duplicateCheck;
  if (dup && conversation.state === "AWAITING_INFO") {
    const existing = await db.ticket.findUnique({ where: { id: dup.ticketId } });
    const clear = () => updateConversation(conversation.id, { state: "IDLE", activeTicketId: null, context: { ...context, duplicateCheck: null } });
    if (!existing || !MERGEABLE_STATUSES.includes(existing.status as TicketStatus)) {
      // Closed in the meantime → file the original message as a new request below
      await clear();
      conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      text = [dup.text, text].filter(Boolean).join("\n");
      attachmentIds.push(...(dup.attachmentIds ?? []));
    } else {
      const different = isDifferentIssueAnswer(text) || (!isSameIssueAnswer(text) && hasMaintenanceVocabulary(text));
      const same = !different && (isSameIssueAnswer(text) || (dup.asked ?? 1) >= 2);
      if (different) {
        await clear();
        const issueText = hasMaintenanceVocabulary(text) && !isNegativeOnly(text) ? `${dup.text}\n${text}` : dup.text;
        return addIssue(
          existing.id,
          { text: issueText, issue: dup.issue, aiPriority: dup.aiPriority, aiConfidence: dup.aiConfidence, attachmentIds: [...(dup.attachmentIds ?? []), ...attachmentIds], messageId: dup.messageId },
          [inbound.id],
        );
      }
      if (same) {
        await clear();
        const { body, full } = await commentOn(existing.id, dup.text, [dup.messageId, inbound.id], "duplicate_same");
        if (dup.attachmentIds?.length || attachmentIds.length) {
          await db.ticketAttachment.updateMany({ where: { id: { in: [...(dup.attachmentIds ?? []), ...attachmentIds] } }, data: { ticketId: existing.id } });
        }
        return { action: "duplicate_same", residentId: resident.id, conversationId: conversation.id, ticketId: existing.id, ticketNumber: full.ticketNumber, replies: [body] };
      }
      // Unclear answer → ask once more
      await updateConversation(conversation.id, { context: { ...context, duplicateCheck: { ...dup, asked: (dup.asked ?? 1) + 1 } } });
      const body = await askSameOrDifferent(await getTicketOrThrow(existing.id));
      return { action: "duplicate_check", residentId: resident.id, conversationId: conversation.id, ticketId: existing.id, ticketNumber: existing.ticketNumber, replies: [body] };
    }
  }

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

  // ── 4a. A reaction to an open request ("ساعتين؟!", "لسه محدش جه", "شكراً") is a comment on
  //        that ticket, not a new request: no maintenance vocabulary + nothing the AI could classify.
  if (text && !attachmentIds.length && !hasMaintenanceVocabulary(text)) {
    const c = outcome.classification;
    const vague = !c.isMaintenanceRequest || c.category === "OTHER" || c.confidence < 0.6;
    const recent = vague
      ? await db.ticket.findFirst({
          where: { residentId: resident.id, status: { in: OPEN_STATUSES }, updatedAt: { gte: new Date(Date.now() - RECENT_TICKET_MS) } },
          orderBy: { updatedAt: "desc" },
        })
      : null;
    if (recent) {
      const { body } = await commentOn(recent.id, text, [inbound.id], "comment_received");
      return { action: "comment", residentId: resident.id, conversationId: conversation.id, ticketId: recent.id, ticketNumber: recent.ticketNumber, replies: [body] };
    }
  }

  // ── 4b. Same type as an open ticket → don't open a duplicate
  {
    const c = outcome.classification;
    const existing = !opts.skipDuplicateCheck && c.isMaintenanceRequest && requestText && c.category !== "OTHER" ? await findOpenTicketOfSameType(resident.id, resident.unitId, c.category) : null;
    if (existing) {
      const cat = await db.category.findUnique({ where: { key: c.category } });
      const urgent =
        evaluatePriority({
          text: requestText,
          globalRules: await getGlobalPriorityRules(),
          categoryDefault: (cat?.defaultPriority as Priority | undefined) ?? CATEGORY_BY_KEY[c.category]?.defaultPriority,
          categoryRules: (cat?.priorityRules as unknown as PriorityRule[] | undefined) ?? [],
          aiPriority: c.priority,
        }).priority === "EMERGENCY";
      const issue = lang === "ar" ? c.issueAr ?? c.issue : c.issue;
      // Clearly another problem ("مشكلة تانية…") or an emergency → add it right away; otherwise ask
      if (mentionsDistinctIssue(requestText) || urgent) {
        return addIssue(existing.id, { text: requestText, issue, aiPriority: c.priority, aiConfidence: c.confidence, attachmentIds, messageId: inbound.id });
      }
      await updateConversation(conversation.id, {
        state: "AWAITING_INFO",
        activeTicketId: existing.id,
        context: {
          ...context,
          duplicateCheck: { ticketId: existing.id, text: requestText, issue, aiPriority: c.priority, aiConfidence: c.confidence, attachmentIds, messageId: inbound.id, asked: 1 },
        },
      });
      const body = await askSameOrDifferent(existing);
      return { action: "duplicate_check", residentId: resident.id, conversationId: conversation.id, ticketId: existing.id, ticketNumber: existing.ticketNumber, replies: [body] };
    }
  }

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
async function transcribe(buffer: Buffer, fileName: string, mimeType: string, simulatedTranscript?: string, fromSimulator = false): Promise<string | null> {
  const input = { buffer, fileName, mimeType, simulatedTranscript };
  // Simulator voice notes carry their transcript — never send them to a paid API
  if (simulatedTranscript?.trim()) return (await getMockSpeechProvider().transcribe(input)).text;
  for (const provider of [getSpeechProvider(), getFallbackSpeechProvider()]) {
    // The mock invents a plausible transcript: fine for the simulator, never for a real resident's voice note
    if (!provider || (provider.name === "mock" && !fromSimulator)) continue;
    try {
      return (await provider.transcribe(input)).text;
    } catch (e) {
      console.warn(`[speech] ${provider.name} failed: ${(e as Error).message}`);
    }
  }
  return null; // → the resident is asked to type the problem
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

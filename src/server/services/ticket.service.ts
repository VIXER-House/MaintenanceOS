import { randomUUID } from "crypto";
import { Prisma, type Ticket, type TicketEventType, type TicketSource } from "@prisma/client";
import { db } from "@/lib/db";
import { isAffirmativeAnswer } from "@/server/domain/answers";
import { formatTicketNumber, isManager, type Priority, type TicketStatus } from "@/server/domain/constants";
import { PRIORITY_LABELS, STATUS_LABELS, formatMinutesHuman } from "@/server/domain/labels";
import type { PriorityRule } from "@/server/domain/categories";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import { evaluatePriority } from "@/server/engines/priority/priority-engine";
import { assertTransition, InvalidTransitionError } from "@/server/engines/lifecycle/ticket-lifecycle";
import { canApproveAmount, computeQuotationTotals, type QuotationItemInput } from "@/server/engines/quotation/quotation-engine";
import type { MaintenanceClassification, ConversationTurn } from "@/server/providers/ai";
import { AI_ACTOR, SYSTEM_ACTOR, type Actor } from "./actor";
import { classifyRequest, type ClassificationOutcome } from "./ai.service";
import { getAssignmentRecommendation } from "./assignment.service";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { recordEvent } from "./event.service";
import { getOrCreateConversation, sendResidentUpdate, updateConversation, ctx } from "./messaging.service";
import { notifyRoles, notifyUsers } from "./notification.service";
import { computeTicketSla } from "./sla.service";
import { recomputeContractorMetrics } from "./contractor.service";

// ───────────────────────── helpers ─────────────────────────

const ticketInclude = {
  category: true,
  resident: true,
  unit: { include: { building: true } },
  technician: { include: { user: { select: { id: true } } } },
  contractor: { include: { users: { select: { id: true } } } },
  asset: true,
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export async function getTicketOrThrow(id: string): Promise<TicketWithRelations> {
  const t = await db.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw new NotFoundError("Ticket");
  return t;
}

async function residentLang(residentId: string | null | undefined): Promise<"ar" | "en"> {
  if (!residentId) return "ar";
  const r = await db.resident.findUnique({ where: { id: residentId }, select: { language: true } });
  return r?.language === "en" ? "en" : "ar";
}

function assigneeName(t: TicketWithRelations, lang: "ar" | "en"): string | null {
  if (t.technician) return lang === "ar" ? t.technician.nameAr ?? t.technician.name : t.technician.name;
  if (t.contractor) return lang === "ar" ? t.contractor.nameAr ?? t.contractor.name : t.contractor.name;
  return null;
}

function assigneeUserIds(t: TicketWithRelations): string[] {
  return [t.technician?.user.id, ...(t.contractor?.users.map((u) => u.id) ?? [])].filter(Boolean) as string[];
}

/** Field actions: managers, or the technician/contractor assigned to the ticket. */
function ensureFieldAccess(t: Ticket, actor: Actor) {
  if (actor.type === "SYSTEM" || actor.type === "AI") return;
  if (actor.role && isManager(actor.role)) return;
  if (actor.technicianId && actor.technicianId === t.technicianId) return;
  if (actor.contractorId && actor.contractorId === t.contractorId) return;
  throw new ForbiddenError("Only the assigned technician/contractor or a manager can update this ticket");
}

function ensureManager(actor: Actor) {
  if (actor.type === "SYSTEM") return;
  if (!actor.role || !isManager(actor.role)) throw new ForbiddenError("This action requires a manager");
}

/**
 * Atomic status transition: validates against the state machine, uses the current
 * status as an optimistic lock, and writes the audit event in the same transaction.
 */
async function move(
  t: Ticket,
  to: TicketStatus,
  actor: Actor,
  eventType: TicketEventType,
  message: string,
  update: Prisma.TicketUpdateInput = {},
  data: Record<string, unknown> = {},
) {
  assertTransition(t.status, to);
  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.ticket.update({ where: { id: t.id, status: t.status }, data: { status: to, ...update } });
      await recordEvent(t.id, eventType, actor, message, { from: t.status, to, ...data } as Prisma.InputJsonValue, tx);
      return updated;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw new ConflictError("Ticket was modified by someone else — refresh and try again");
    }
    throw e;
  }
}

function money(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

// ───────────────────────── intake & triage ─────────────────────────

export interface CreateTicketInput {
  text: string;
  source: TicketSource;
  residentId?: string | null;
  unitId?: string | null;
  compoundId?: string | null;
  actor: Actor;
  /** Precomputed AI outcome (the WhatsApp intake classifies before deciding to open a ticket) */
  outcome?: ClassificationOutcome;
  imageFindings?: { issue: string; categoryKey?: string | null; confidence: number }[];
  attachmentIds?: string[];
  messageId?: string | null;
  /** Manager overrides from manual creation (human-in-the-loop) */
  overrides?: { categoryKey?: string | null; priority?: Priority | null };
  /** When false, an AI follow-up question is ignored (e.g. manual web creation) */
  allowFollowUp?: boolean;
  isDemo?: boolean;
}

export interface TriageResult {
  ticket: TicketWithRelations;
  outcome: ClassificationOutcome;
  needsMoreInfo: boolean;
  followUpQuestion: string | null;
  priorityReasons: string[];
  assignment: { strategy: string; reason: string };
}

async function knownAssetsFor(unitId: string | null | undefined) {
  if (!unitId) return [];
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { buildingId: true } });
  const assets = await db.asset.findMany({
    where: { OR: [{ unitId }, { buildingId: unit?.buildingId, unitId: null }] },
    select: { id: true, assetCode: true, name: true, type: true, location: true },
  });
  return assets;
}

function matchAsset(
  assets: Awaited<ReturnType<typeof knownAssetsFor>>,
  c: Pick<MaintenanceClassification, "assetCode" | "assetType" | "location">,
) {
  if (c.assetCode) {
    const byCode = assets.find((a) => a.assetCode === c.assetCode);
    if (byCode) return byCode;
  }
  if (!c.assetType) return null;
  const candidates = assets.filter((a) => a.type.toLowerCase() === c.assetType!.toLowerCase());
  if (c.location) {
    const loc = c.location.toLowerCase();
    const byLoc = candidates.find((a) => a.location.toLowerCase().includes(loc) || loc.includes(a.location.toLowerCase()));
    if (byLoc) return byLoc;
  }
  // Fall back to "the only one" only when no conflicting location was mentioned
  return !c.location && candidates.length === 1 ? candidates[0] : null;
}

/**
 * Creates a ticket and runs it through AI triage:
 * NEW → AI_ANALYZING → (WAITING_FOR_INFO | NEW → ASSIGNED)
 */
export async function createAndTriageTicket(input: CreateTicketInput): Promise<TriageResult> {
  let unitId = input.unitId ?? null;
  let compoundId = input.compoundId ?? null;
  if (input.residentId && !unitId) {
    const r = await db.resident.findUnique({ where: { id: input.residentId }, select: { unitId: true } });
    unitId = r?.unitId ?? null;
  }
  if (unitId && !compoundId) {
    const u = await db.unit.findUnique({ where: { id: unitId }, include: { building: true } });
    compoundId = u?.building.compoundId ?? null;
  }
  if (!compoundId) compoundId = (await db.compound.findFirst({ select: { id: true } }))?.id ?? null;
  if (!compoundId) throw new AppError("No compound configured");

  // 1. Create (ticket number allocated from the DB sequence)
  const created = await db.$transaction(async (tx) => {
    const t = await tx.ticket.create({
      data: {
        ticketNumber: `TMP-${randomUUID()}`,
        compoundId: compoundId!,
        residentId: input.residentId ?? null,
        unitId,
        title: input.text.slice(0, 90),
        description: input.text,
        source: input.source,
        status: "NEW",
        isDemo: input.isDemo ?? false,
      },
    });
    const ticketNumber = formatTicketNumber(t.number);
    const t2 = await tx.ticket.update({ where: { id: t.id }, data: { ticketNumber } });
    await recordEvent(t.id, "TICKET_CREATED", input.actor, `Ticket ${ticketNumber} created via ${input.source}`, { source: input.source }, tx);
    if (input.attachmentIds?.length) {
      await tx.ticketAttachment.updateMany({ where: { id: { in: input.attachmentIds } }, data: { ticketId: t.id } });
    }
    if (input.messageId) await tx.ticketMessage.update({ where: { id: input.messageId }, data: { ticketId: t.id } });
    return t2;
  });

  // 2. AI analysis
  let ticket: Ticket = await move(created, "AI_ANALYZING", AI_ACTOR, "AI_ANALYZING", "AI analysis started");
  const knownAssets = await knownAssetsFor(unitId);
  const outcome =
    input.outcome ??
    (await classifyRequest({
      text: input.text,
      imageFindings: input.imageFindings,
      knownAssets,
      disallowFollowUp: input.allowFollowUp === false,
    }));

  const applied = await applyAnalysis(ticket.id, outcome, { text: input.text, overrides: input.overrides, messageId: input.messageId });
  ticket = applied.ticket;

  const needsMoreInfo = input.allowFollowUp !== false && outcome.classification.needsMoreInfo && !!outcome.classification.followUpQuestion;
  let assignment = { strategy: "NONE", reason: "Waiting for resident information" };
  if (needsMoreInfo) {
    ticket = await move(ticket, "WAITING_FOR_INFO", AI_ACTOR, "INFO_REQUESTED", `AI asked: ${outcome.classification.followUpQuestion}`, {}, {
      question: outcome.classification.followUpQuestion,
    });
  } else {
    ticket = await move(ticket, "NEW", AI_ACTOR, "STATUS_CHANGED", "AI analysis complete — ready for dispatch");
    assignment = await autoAssign(ticket.id);
  }

  const full = await getTicketOrThrow(ticket.id);
  await alertManagersOfNewTicket(full);
  return {
    ticket: full,
    outcome,
    needsMoreInfo,
    followUpQuestion: needsMoreInfo ? outcome.classification.followUpQuestion : null,
    priorityReasons: applied.priorityReasons,
    assignment,
  };
}

/** Persist an AI analysis and apply validated decisions (category, priority, SLA, asset). */
export async function applyAnalysis(
  ticketId: string,
  outcome: ClassificationOutcome,
  opts: { text: string; overrides?: CreateTicketInput["overrides"]; messageId?: string | null; isFollowUp?: boolean },
) {
  const t = await getTicketOrThrow(ticketId);
  const c = outcome.classification;
  const categoryKey = opts.overrides?.categoryKey ?? c.category;
  const category = await db.category.findUnique({ where: { key: categoryKey } });

  const decision = evaluatePriority({
    text: opts.text,
    categoryDefault: (category?.defaultPriority as Priority) ?? CATEGORY_BY_KEY[categoryKey]?.defaultPriority ?? "MEDIUM",
    categoryRules: (category?.priorityRules as unknown as PriorityRule[]) ?? [],
    aiPriority: c.priority,
    aiConfidence: c.confidence,
  });
  // Manual override (manager) wins; a previous manager override is preserved on follow-ups.
  let priority: Priority = opts.overrides?.priority ?? decision.priority;
  if (t.priorityOverridden) priority = t.priority as Priority;

  const knownAssets = await knownAssetsFor(t.unitId);
  const asset = t.assetId ? null : matchAsset(knownAssets, c);
  const sla = await computeTicketSla(priority, t.createdAt, category?.defaultResolutionMinutes);
  const previousPriority = t.priority;

  const analysis = await db.$transaction(async (tx) => {
    const a = await tx.aIAnalysis.create({
      data: {
        ticketId,
        messageId: opts.messageId ?? null,
        provider: outcome.provider,
        model: outcome.model,
        input: opts.text,
        language: c.language,
        categoryKey,
        priority: c.priority,
        issue: c.issue,
        location: c.location,
        assetHint: asset?.assetCode ?? c.assetType,
        confidence: c.confidence,
        recommendedAction: c.recommendedAction,
        reasoning: c.reasoning,
        entities: {
          issueAr: c.issueAr,
          severity: c.severity,
          assetType: c.assetType,
          assetCode: asset?.assetCode ?? null,
          priorityDecision: { source: decision.source, reasons: decision.reasons, rulePriority: decision.rulePriority },
        } as Prisma.InputJsonValue,
        needsMoreInfo: c.needsMoreInfo,
        followUpQuestion: c.followUpQuestion,
        rawResponse: c as unknown as Prisma.InputJsonValue,
        latencyMs: outcome.latencyMs,
        fallbackUsed: outcome.fallbackUsed,
      },
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        title: c.title.slice(0, 120),
        description: opts.isFollowUp ? `${t.description}\n— ${opts.text.split("\n").pop()}` : t.description,
        location: c.location ?? t.location,
        categoryId: category?.id ?? null,
        priority,
        aiSuggestedPriority: c.priority,
        assetId: t.assetId ?? asset?.id ?? null,
        slaResponseDueAt: sla.responseDueAt,
        slaResolutionDueAt: sla.resolutionDueAt,
      },
    });
    await recordEvent(
      ticketId,
      "AI_ANALYZED",
      AI_ACTOR,
      `AI classified as ${category?.nameEn ?? categoryKey} · ${c.issue} (${Math.round(c.confidence * 100)}% confidence${outcome.fallbackUsed ? ", fallback model" : ""})`,
      { analysisId: a.id, provider: outcome.provider, aiPriority: c.priority, finalPriority: priority, reasons: decision.reasons },
      tx,
    );
    if (previousPriority !== priority || !opts.isFollowUp) {
      await recordEvent(
        ticketId,
        "PRIORITY_CHANGED",
        SYSTEM_ACTOR,
        `Priority set to ${priority} by priority engine${c.priority !== priority ? ` (AI suggested ${c.priority})` : ""}`,
        { from: previousPriority, to: priority, reasons: decision.reasons },
        tx,
      );
      await recordEvent(
        ticketId,
        "SLA_SET",
        SYSTEM_ACTOR,
        `SLA: respond within ${formatMinutesHuman(sla.responseMinutes, "en")}, resolve within ${formatMinutesHuman(sla.resolutionMinutes, "en")}`,
        { responseDueAt: sla.responseDueAt.toISOString(), resolutionDueAt: sla.resolutionDueAt.toISOString() },
        tx,
      );
    }
    return a;
  });

  return {
    ticket: await db.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
    analysis,
    priorityReasons: decision.reasons,
    escalated: previousPriority !== priority,
    sla,
  };
}

/** Follow-up answer from the resident for a WAITING_FOR_INFO ticket. */
export async function handleFollowUpAnswer(ticketId: string, answer: string, actor: Actor, messageId?: string | null) {
  let t: Ticket = await getTicketOrThrow(ticketId);
  if (t.status !== "WAITING_FOR_INFO") throw new ConflictError("Ticket is not waiting for information");
  await recordEvent(t.id, "INFO_RECEIVED", actor, `Resident replied: "${answer.slice(0, 200)}"`);
  if (messageId) await db.ticketMessage.update({ where: { id: messageId }, data: { ticketId: t.id } });
  t = await move(t, "AI_ANALYZING", AI_ACTOR, "AI_ANALYZING", "Re-analyzing with resident's answer");

  const lastAnalysis = await db.aIAnalysis.findFirst({ where: { ticketId }, orderBy: { createdAt: "desc" } });
  const history: ConversationTurn[] = [
    { role: "resident", text: t.description },
    ...(lastAnalysis?.followUpQuestion ? [{ role: "assistant" as const, text: lastAnalysis.followUpQuestion }] : []),
  ];
  // A "yes" only carries meaning together with the question: "is anyone trapped?" + "yes, two people"
  // must be judged as "people trapped" by the safety rules.
  const confirmedQuestion = lastAnalysis?.followUpQuestion && isAffirmativeAnswer(answer) ? lastAnalysis.followUpQuestion : null;
  const outcome = await classifyRequest({ text: confirmedQuestion ? `${answer} (answer to: ${confirmedQuestion})` : answer, history, knownAssets: await knownAssetsFor(t.unitId), disallowFollowUp: true });
  const combined = [t.description, confirmedQuestion ? `${confirmedQuestion} → ${answer}` : answer].join("\n");
  const applied = await applyAnalysis(t.id, outcome, { text: combined, messageId, isFollowUp: true });
  t = await move(applied.ticket, "NEW", AI_ACTOR, "STATUS_CHANGED", "Information complete — ready for dispatch");
  const assignment = await autoAssign(t.id);
  return { ticket: await getTicketOrThrow(t.id), escalated: applied.escalated, outcome, assignment, sla: applied.sla };
}

/**
 * Automatic assignment. Internal technicians are assigned automatically; contractors
 * are only suggested and must be confirmed by a manager (human-in-the-loop).
 */
export async function autoAssign(ticketId: string): Promise<{ strategy: string; reason: string }> {
  const t = await getTicketOrThrow(ticketId);
  const categoryKey = t.category?.key ?? "OTHER";
  const rec = await getAssignmentRecommendation(categoryKey, t.category?.requiredSkill ?? "GENERAL");
  if (rec.strategy === "TECHNICIAN" && rec.technician) {
    await assignTicket(
      ticketId,
      { technicianId: rec.technician.technician.id },
      SYSTEM_ACTOR,
      `Auto-assigned to ${rec.technician.technician.name} (score ${rec.technician.score}: ${rec.technician.reasons.join(", ")})`,
      { notifyResident: false },
    );
    return { strategy: rec.strategy, reason: rec.reason };
  }
  if (rec.strategy === "CONTRACTOR" && rec.contractor) {
    await db.ticket.update({ where: { id: ticketId }, data: { suggestedContractorId: rec.contractor.contractor.id } });
    await recordEvent(ticketId, "NOTE_ADDED", SYSTEM_ACTOR, `Suggested contractor ${rec.contractor.contractor.name} — awaiting manager confirmation`, {
      contractorId: rec.contractor.contractor.id,
      score: rec.contractor.score,
    });
    await notifyRoles(["MAINTENANCE_MANAGER"], {
      title: `Confirm contractor for ${t.ticketNumber}`,
      body: `${rec.reason}`,
      link: `/tickets/${t.id}`,
      ticketId: t.id,
    });
    return { strategy: rec.strategy, reason: rec.reason };
  }
  await recordEvent(ticketId, "NOTE_ADDED", SYSTEM_ACTOR, rec.reason);
  await notifyRoles(["MAINTENANCE_MANAGER"], { title: `Manual assignment needed: ${t.ticketNumber}`, body: rec.reason, link: `/tickets/${t.id}`, ticketId: t.id });
  return { strategy: rec.strategy, reason: rec.reason };
}

async function alertManagersOfNewTicket(t: TicketWithRelations) {
  const roles: ("MAINTENANCE_MANAGER" | "COMPOUND_MANAGER")[] = ["MAINTENANCE_MANAGER"];
  if (t.priority === "EMERGENCY" || t.priority === "CRITICAL") roles.push("COMPOUND_MANAGER");
  await notifyRoles(roles, {
    title: `${t.priority === "EMERGENCY" ? "🚨 " : ""}New ${t.priority.toLowerCase()} ticket ${t.ticketNumber}`,
    body: `${t.title}${t.unit ? ` · ${t.unit.code}` : ""}`,
    link: `/tickets/${t.id}`,
    ticketId: t.id,
  });
}

// ───────────────────────── lifecycle actions ─────────────────────────

export async function assignTicket(
  ticketId: string,
  target: { technicianId?: string | null; contractorId?: string | null },
  actor: Actor,
  reason?: string,
  opts: { notifyResident?: boolean } = {},
) {
  if (actor.type !== "SYSTEM") ensureManager(actor);
  if (!target.technicianId && !target.contractorId) throw new AppError("Choose a technician or a contractor");
  const t = await getTicketOrThrow(ticketId);
  if (["CLOSED", "CANCELLED", "COMPLETED", "WAITING_APPROVAL"].includes(t.status)) {
    throw new ConflictError(`Cannot assign a ticket that is ${t.status}`);
  }
  const tech = target.technicianId ? await db.technician.findUnique({ where: { id: target.technicianId } }) : null;
  const contractor = target.contractorId ? await db.contractor.findUnique({ where: { id: target.contractorId } }) : null;
  if (target.technicianId && !tech) throw new NotFoundError("Technician");
  if (target.contractorId && !contractor) throw new NotFoundError("Contractor");

  const assignee = tech?.name ?? contractor!.name;
  const isReassign = !!(t.technicianId || t.contractorId);
  const update: Prisma.TicketUpdateInput = {
    technician: tech ? { connect: { id: tech.id } } : { disconnect: true },
    contractor: contractor ? { connect: { id: contractor.id } } : { disconnect: true },
    team: tech?.teamId ? { connect: { id: tech.teamId } } : undefined,
    assignedAt: new Date(),
    suggestedContractorId: contractor ? null : undefined,
  };
  const eventType: TicketEventType = isReassign ? "REASSIGNED" : "ASSIGNED";
  const msg = reason ?? `${isReassign ? "Reassigned" : "Assigned"} to ${assignee}${actor.type === "STAFF" ? ` by ${actor.name}` : ""}`;

  if (["NEW", "AI_ANALYZING", "WAITING_FOR_INFO", "ACKNOWLEDGED", "IN_PROGRESS"].includes(t.status)) {
    // a new assignee must acknowledge again
    await move(t, "ASSIGNED", actor, eventType, msg, update, { technicianId: tech?.id, contractorId: contractor?.id });
  } else {
    await db.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: t.id }, data: update });
      await recordEvent(t.id, eventType, actor, msg, { technicianId: tech?.id, contractorId: contractor?.id }, tx);
    });
  }

  const updated = await getTicketOrThrow(ticketId);
  await notifyUsers(assigneeUserIds(updated), {
    title: `New job ${updated.ticketNumber} · ${updated.priority}`,
    body: `${updated.title}${updated.unit ? ` — unit ${updated.unit.code}` : ""}`,
    link: `/tickets/${updated.id}`,
    ticketId: updated.id,
  });
  if (opts.notifyResident !== false) {
    const lang = await residentLang(updated.residentId);
    await sendResidentUpdate(updated.residentId, "assigned", { ticketNumber: updated.ticketNumber, technician: assigneeName(updated, lang) }, updated.id);
  }
  return updated;
}

export async function acknowledgeTicket(ticketId: string, actor: Actor) {
  const t = await getTicketOrThrow(ticketId);
  ensureFieldAccess(t, actor);
  const now = new Date();
  await move(t, "ACKNOWLEDGED", actor, "ACKNOWLEDGED", `${actor.name} acknowledged the job`, {
    acknowledgedAt: t.acknowledgedAt ?? now,
    slaResponseBreached: t.slaResponseDueAt ? now > t.slaResponseDueAt : false,
  });
  const updated = await getTicketOrThrow(ticketId);
  const lang = await residentLang(updated.residentId);
  await sendResidentUpdate(updated.residentId, "acknowledged", { ticketNumber: updated.ticketNumber, technician: assigneeName(updated, lang) }, updated.id);
  return updated;
}

export async function startTicket(ticketId: string, actor: Actor) {
  let t: Ticket = await getTicketOrThrow(ticketId);
  ensureFieldAccess(t, actor);
  if (t.status === "ASSIGNED") {
    await acknowledgeTicket(ticketId, actor);
    t = await getTicketOrThrow(ticketId);
  }
  await move(t, "IN_PROGRESS", actor, "STARTED", t.startedAt ? `${actor.name} resumed work` : `${actor.name} started work`, {
    startedAt: t.startedAt ?? new Date(),
  });
  const updated = await getTicketOrThrow(ticketId);
  if (!t.startedAt) await sendResidentUpdate(updated.residentId, "started", { ticketNumber: updated.ticketNumber }, updated.id);
  return updated;
}

export async function requestQuotation(ticketId: string, actor: Actor, note?: string) {
  const t = await getTicketOrThrow(ticketId);
  ensureFieldAccess(t, actor);
  await move(t, "WAITING_QUOTATION", actor, "QUOTATION_REQUESTED", note ? `Quotation requested: ${note}` : "Quotation requested", {
    requiresQuotation: true,
  });
  return getTicketOrThrow(ticketId);
}

export interface SubmitQuotationInput {
  items: QuotationItemInput[];
  vatRate?: number;
  estimatedHours?: number | null;
  notes?: string | null;
  contractorId?: string | null;
}

export async function submitQuotation(ticketId: string, input: SubmitQuotationInput, actor: Actor) {
  let t: Ticket = await getTicketOrThrow(ticketId);
  ensureFieldAccess(t, actor);
  if (t.status === "ASSIGNED") {
    await acknowledgeTicket(ticketId, actor);
    t = await getTicketOrThrow(ticketId);
  }
  if (t.status !== "WAITING_QUOTATION") {
    t = await move(t, "WAITING_QUOTATION", actor, "QUOTATION_REQUESTED", "Quotation required", { requiresQuotation: true });
  }
  const totals = computeQuotationTotals(input.items, input.vatRate);
  const prior = await db.quotation.count({ where: { ticketId } });
  const version = prior + 1;
  const estimatedCompletionAt = input.estimatedHours ? new Date(Date.now() + input.estimatedHours * 3600_000) : null;

  const quotation = await db.$transaction(async (tx) => {
    await tx.quotation.updateMany({
      where: { ticketId, status: { in: ["SUBMITTED", "REVISION_REQUESTED"] } },
      data: { status: "SUPERSEDED" },
    });
    const q = await tx.quotation.create({
      data: {
        ticketId,
        number: `Q-${t.ticketNumber.replace("MAINT-", "")}-${version}`,
        version,
        status: "SUBMITTED",
        contractorId: input.contractorId ?? t.contractorId ?? null,
        createdById: actor.userId ?? null,
        createdByName: actor.name,
        laborCost: totals.laborCost,
        materialsCost: totals.materialsCost,
        subtotal: totals.subtotal,
        vatRate: totals.vatRate,
        vatAmount: totals.vatAmount,
        total: totals.total,
        estimatedHours: input.estimatedHours ?? null,
        estimatedCompletionAt,
        notes: input.notes ?? null,
        items: {
          create: totals.items.map((i) => ({
            type: i.type,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
          })),
        },
      },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { estimatedCost: totals.total, requiresQuotation: true } });
    return q;
  });

  await move(
    await db.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
    "WAITING_APPROVAL",
    actor,
    "QUOTATION_CREATED",
    `Quotation ${quotation.number} submitted: ${totals.total.toLocaleString("en-US")} EGP (labor ${totals.laborCost}, materials ${totals.materialsCost}, VAT ${totals.vatAmount})`,
    {},
    { quotationId: quotation.id, total: totals.total },
  );

  const updated = await getTicketOrThrow(ticketId);
  const approverRoles: ("MAINTENANCE_MANAGER" | "COMPOUND_MANAGER")[] = canApproveAmount("MAINTENANCE_MANAGER", totals.total)
    ? ["MAINTENANCE_MANAGER"]
    : ["MAINTENANCE_MANAGER", "COMPOUND_MANAGER"];
  await notifyRoles(approverRoles, {
    title: `Approval needed: ${quotation.number}`,
    body: `${updated.ticketNumber} · ${totals.total.toLocaleString("en-US")} EGP — ${updated.title}`,
    link: `/tickets/${updated.id}`,
    ticketId: updated.id,
  });
  await sendResidentUpdate(updated.residentId, "quotation_pending", { ticketNumber: updated.ticketNumber }, updated.id);
  return { ticket: updated, quotation };
}

async function pendingQuotation(ticketId: string, quotationId?: string | null) {
  const q = quotationId
    ? await db.quotation.findFirst({ where: { id: quotationId, ticketId } })
    : await db.quotation.findFirst({ where: { ticketId, status: "SUBMITTED" }, orderBy: { createdAt: "desc" } });
  if (!q) throw new NotFoundError("Pending quotation");
  if (q.status !== "SUBMITTED") throw new ConflictError(`Quotation is ${q.status}`);
  return q;
}

/** Financial approval — manager only, with approval limits. Never performed by AI. */
export async function approveQuotation(ticketId: string, actor: Actor, opts: { quotationId?: string | null; notes?: string | null } = {}) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  const q = await pendingQuotation(ticketId, opts.quotationId);
  const total = Number(q.total);
  if (actor.role && !canApproveAmount(actor.role, total)) {
    throw new ForbiddenError(`Amount ${total.toLocaleString("en-US")} EGP exceeds your approval limit — escalate to the compound manager`);
  }
  await db.quotation.update({
    where: { id: q.id },
    data: { status: "APPROVED", reviewedById: actor.userId ?? null, reviewedByName: actor.name, reviewedAt: new Date(), reviewNotes: opts.notes ?? null },
  });
  let updated: Ticket = await move(t, "APPROVED", actor, "QUOTATION_APPROVED", `${actor.name} approved ${q.number} (${total.toLocaleString("en-US")} EGP)`, {
    approvedCost: q.total,
  }, { quotationId: q.id });

  // Approved → In progress (work resumes automatically when it had already started)
  if (t.startedAt || t.acknowledgedAt) {
    updated = await move(updated, "IN_PROGRESS", SYSTEM_ACTOR, "STARTED", "Work resumed after quotation approval");
  }
  const full = await getTicketOrThrow(ticketId);
  await notifyUsers(assigneeUserIds(full), {
    title: `Quotation approved: ${q.number}`,
    body: `${full.ticketNumber} — proceed with the work.`,
    link: `/tickets/${full.id}`,
    ticketId: full.id,
  });
  await sendResidentUpdate(full.residentId, "approved", { ticketNumber: full.ticketNumber }, full.id);
  return full;
}

export async function rejectQuotation(ticketId: string, actor: Actor, opts: { quotationId?: string | null; notes?: string | null } = {}) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  const q = await pendingQuotation(ticketId, opts.quotationId);
  await db.quotation.update({
    where: { id: q.id },
    data: { status: "REJECTED", reviewedById: actor.userId ?? null, reviewedByName: actor.name, reviewedAt: new Date(), reviewNotes: opts.notes ?? null },
  });
  await move(t, "REJECTED", actor, "QUOTATION_REJECTED", `${actor.name} rejected ${q.number}${opts.notes ? `: ${opts.notes}` : ""}`, {}, { quotationId: q.id });
  const full = await getTicketOrThrow(ticketId);
  await notifyUsers(assigneeUserIds(full), { title: `Quotation rejected: ${q.number}`, body: opts.notes ?? "See ticket for details", link: `/tickets/${full.id}`, ticketId: full.id });
  return full;
}

export async function requestQuotationRevision(ticketId: string, actor: Actor, opts: { quotationId?: string | null; notes?: string | null } = {}) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  const q = await pendingQuotation(ticketId, opts.quotationId);
  await db.quotation.update({
    where: { id: q.id },
    data: { status: "REVISION_REQUESTED", reviewedById: actor.userId ?? null, reviewedByName: actor.name, reviewedAt: new Date(), reviewNotes: opts.notes ?? null },
  });
  await move(t, "WAITING_QUOTATION", actor, "QUOTATION_REVISION_REQUESTED", `${actor.name} requested a revision of ${q.number}${opts.notes ? `: ${opts.notes}` : ""}`, {}, {
    quotationId: q.id,
  });
  const full = await getTicketOrThrow(ticketId);
  await notifyUsers(assigneeUserIds(full), { title: `Revise quotation ${q.number}`, body: opts.notes ?? "Manager requested changes", link: `/tickets/${full.id}`, ticketId: full.id });
  return full;
}

export async function completeTicket(ticketId: string, actor: Actor, opts: { notes?: string | null; finalCost?: number | null } = {}) {
  let t: Ticket = await getTicketOrThrow(ticketId);
  ensureFieldAccess(t, actor);
  if (t.status === "WAITING_APPROVAL") throw new ConflictError("Quotation is still waiting for manager approval");
  if (t.status === "APPROVED" || t.status === "ACKNOWLEDGED" || t.status === "REJECTED") {
    t = await move(t, "IN_PROGRESS", actor, "STARTED", `${actor.name} started work`, { startedAt: t.startedAt ?? new Date() });
  }
  if (t.status === "ASSIGNED") {
    await startTicket(ticketId, actor);
    t = await getTicketOrThrow(ticketId);
  }
  const now = new Date();
  const finalCost = opts.finalCost ?? money(t.approvedCost) ?? money(t.estimatedCost) ?? 0;
  await move(t, "COMPLETED", actor, "COMPLETED", `${actor.name} completed the work${opts.notes ? `: ${opts.notes}` : ""}`, {
    completedAt: now,
    finalCost,
    resolutionNotes: opts.notes ?? null,
    slaResolutionBreached: t.slaResolutionDueAt ? now > t.slaResolutionDueAt : false,
  }, { finalCost });

  const full = await getTicketOrThrow(ticketId);

  // Asset maintenance history
  if (full.assetId) {
    await db.$transaction(async (tx) => {
      await tx.assetMaintenance.create({
        data: {
          assetId: full.assetId!,
          ticketId: full.id,
          date: now,
          type: full.priority === "EMERGENCY" ? "EMERGENCY" : "CORRECTIVE",
          description: `${full.title}${opts.notes ? ` — ${opts.notes}` : ""}`,
          cost: finalCost,
          performedBy: full.technician?.name ?? full.contractor?.name ?? actor.name,
        },
      });
      await tx.asset.update({ where: { id: full.assetId! }, data: { status: "OPERATIONAL" } });
      await recordEvent(full.id, "ASSET_HISTORY_UPDATED", SYSTEM_ACTOR, `Maintenance record added to asset ${full.asset?.assetCode}`, { assetId: full.assetId }, tx);
    });
  }
  if (full.contractorId) await recomputeContractorMetrics(full.contractorId);

  // Ask the resident to confirm
  if (full.residentId) {
    const conversation = await getOrCreateConversation(full.residentId, full.resident!.phone);
    await updateConversation(conversation.id, { state: "AWAITING_CONFIRMATION", activeTicketId: full.id, context: { ...ctx(conversation) } });
    await sendResidentUpdate(full.residentId, "completed", { ticketNumber: full.ticketNumber, notes: opts.notes ?? null }, full.id);
  }
  await notifyRoles(["MAINTENANCE_MANAGER"], { title: `Completed: ${full.ticketNumber}`, body: `${full.title} — ready to close`, link: `/tickets/${full.id}`, ticketId: full.id });
  return full;
}

export async function closeTicket(ticketId: string, actor: Actor, notes?: string | null) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  await move(t, "CLOSED", actor, "CLOSED", `${actor.name} closed the ticket${notes ? `: ${notes}` : ""}`, { closedAt: new Date() });
  const full = await getTicketOrThrow(ticketId);
  if (full.residentId) {
    const conversation = await getOrCreateConversation(full.residentId, full.resident!.phone);
    if (conversation.activeTicketId === full.id) await updateConversation(conversation.id, { state: "IDLE", activeTicketId: null });
    await sendResidentUpdate(full.residentId, "closed", { ticketNumber: full.ticketNumber }, full.id);
  }
  return full;
}

export async function cancelTicket(ticketId: string, actor: Actor, reason?: string | null) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  await move(t, "CANCELLED", actor, "CANCELLED", `${actor.name} cancelled the ticket${reason ? `: ${reason}` : ""}`, { cancelledAt: new Date() });
  return getTicketOrThrow(ticketId);
}

export async function reopenTicket(ticketId: string, actor: Actor, reason?: string | null) {
  if (actor.type !== "RESIDENT") ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  await move(t, "IN_PROGRESS", actor, "REOPENED", `Ticket reopened${reason ? `: ${reason}` : ""}`, { completedAt: null, residentConfirmedAt: null });
  const full = await getTicketOrThrow(ticketId);
  await notifyUsers(assigneeUserIds(full), { title: `Reopened: ${full.ticketNumber}`, body: reason ?? "Resident reports the issue persists", link: `/tickets/${full.id}`, ticketId: full.id });
  return full;
}

/** Resident confirms (or disputes) completion from WhatsApp. */
export async function residentConfirmation(ticketId: string, confirmed: boolean, actor: Actor) {
  const t = await getTicketOrThrow(ticketId);
  if (t.status !== "COMPLETED") throw new ConflictError("Ticket is not awaiting confirmation");
  if (confirmed) {
    await db.ticket.update({ where: { id: ticketId }, data: { residentConfirmedAt: new Date() } });
    await recordEvent(ticketId, "RESIDENT_CONFIRMED", actor, "Resident confirmed the issue is resolved");
    await notifyRoles(["MAINTENANCE_MANAGER"], { title: `Resident confirmed ${t.ticketNumber}`, body: "Ready to close", link: `/tickets/${t.id}`, ticketId: t.id });
    return getTicketOrThrow(ticketId);
  }
  await recordEvent(ticketId, "RESIDENT_DISPUTED", actor, "Resident reports the issue is NOT resolved");
  return reopenTicket(ticketId, actor, "Resident reports the issue persists");
}

/** Manager overrides the priority (human-in-the-loop). SLA is recalculated. */
export async function changePriority(ticketId: string, priority: Priority, actor: Actor, reason?: string | null) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  if (t.priority === priority) return t;
  const sla = await computeTicketSla(priority, t.createdAt, t.category?.defaultResolutionMinutes);
  await db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        priority,
        priorityOverridden: true,
        slaResponseDueAt: sla.responseDueAt,
        slaResolutionDueAt: sla.resolutionDueAt,
        slaResponseBreached: false,
        slaResolutionBreached: false,
      },
    });
    await recordEvent(ticketId, "PRIORITY_CHANGED", actor, `${actor.name} changed priority ${t.priority} → ${priority}${reason ? `: ${reason}` : ""}`, {
      from: t.priority,
      to: priority,
      manual: true,
    }, tx);
    await recordEvent(ticketId, "SLA_SET", SYSTEM_ACTOR, `SLA recalculated: respond within ${formatMinutesHuman(sla.responseMinutes, "en")}, resolve within ${formatMinutesHuman(sla.resolutionMinutes, "en")}`, {
      responseDueAt: sla.responseDueAt.toISOString(),
      resolutionDueAt: sla.resolutionDueAt.toISOString(),
    }, tx);
  });
  return getTicketOrThrow(ticketId);
}

export interface AnalysisEdit {
  categoryKey?: string;
  priority?: Priority;
  title?: string;
  location?: string | null;
  assetId?: string | null;
  recommendedAction?: string | null;
}

/** Manager edits what the AI extracted. Every change is audited. */
export async function editAnalysis(ticketId: string, edit: AnalysisEdit, actor: Actor) {
  ensureManager(actor);
  const t = await getTicketOrThrow(ticketId);
  const changes: string[] = [];
  const data: Prisma.TicketUpdateInput = {};
  if (edit.categoryKey && edit.categoryKey !== t.category?.key) {
    const cat = await db.category.findUnique({ where: { key: edit.categoryKey } });
    if (!cat) throw new NotFoundError("Category");
    data.category = { connect: { id: cat.id } };
    changes.push(`category ${t.category?.key ?? "—"} → ${cat.key}`);
    await recordEvent(ticketId, "CATEGORY_CHANGED", actor, `${actor.name} changed category to ${cat.nameEn}`, { from: t.category?.key, to: cat.key });
  }
  if (edit.title && edit.title !== t.title) {
    data.title = edit.title;
    changes.push("title");
  }
  if (edit.location !== undefined && edit.location !== t.location) {
    data.location = edit.location;
    changes.push(`location → ${edit.location ?? "—"}`);
  }
  if (edit.assetId !== undefined && edit.assetId !== t.assetId) {
    data.asset = edit.assetId ? { connect: { id: edit.assetId } } : { disconnect: true };
    changes.push("asset");
  }
  if (Object.keys(data).length) await db.ticket.update({ where: { id: ticketId }, data });
  const last = await db.aIAnalysis.findFirst({ where: { ticketId }, orderBy: { createdAt: "desc" } });
  if (last && (changes.length || edit.recommendedAction)) {
    await db.aIAnalysis.update({
      where: { id: last.id },
      data: {
        editedById: actor.userId ?? null,
        editedAt: new Date(),
        categoryKey: edit.categoryKey ?? undefined,
        location: edit.location === undefined ? undefined : edit.location,
        recommendedAction: edit.recommendedAction ?? undefined,
      },
    });
  }
  if (changes.length) await recordEvent(ticketId, "AI_ANALYSIS_EDITED", actor, `${actor.name} edited AI analysis: ${changes.join(", ")}`);
  if (edit.priority && edit.priority !== t.priority) await changePriority(ticketId, edit.priority, actor, "Edited from AI analysis");
  return getTicketOrThrow(ticketId);
}

export async function addNote(ticketId: string, note: string, actor: Actor) {
  const t = await getTicketOrThrow(ticketId);
  if (actor.role && !isManager(actor.role)) ensureFieldAccess(t, actor);
  await recordEvent(ticketId, "NOTE_ADDED", actor, note);
  return t;
}

/** Status summary text used by the WhatsApp "status" command */
export function statusLine(t: TicketWithRelations, lang: "ar" | "en") {
  return {
    ticketNumber: t.ticketNumber,
    status: STATUS_LABELS[t.status][lang],
    technician: assigneeName(t, lang),
    eta: t.slaResolutionDueAt
      ? t.slaResolutionDueAt.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" })
      : null,
  };
}

export function residentFacingSummary(t: TicketWithRelations, lang: "ar" | "en", slaMinutes: number, issue?: string | null) {
  return {
    ticketNumber: t.ticketNumber,
    issue: issue ?? t.title,
    category: t.category ? (lang === "ar" ? t.category.nameAr : t.category.nameEn) : "—",
    priority: PRIORITY_LABELS[t.priority][lang],
    sla: formatMinutesHuman(slaMinutes, lang),
    technician: assigneeName(t, lang),
  };
}

export { InvalidTransitionError };

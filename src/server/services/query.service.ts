import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import { OPEN_STATUSES, isManager, type TicketStatus } from "@/server/domain/constants";
import { getSlaStatus } from "@/server/engines/sla/sla-engine";
import { availableActions } from "@/server/engines/lifecycle/ticket-lifecycle";
import { getAssignmentRecommendation } from "./assignment.service";

/**
 * Read models (DTOs) for pages and APIs. Converts Prisma Decimals to numbers and
 * computes live SLA state so the UI never contains business logic.
 */
const num = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v));

export interface TicketFilters {
  status?: string;
  priority?: string;
  category?: string;
  q?: string;
  technicianId?: string;
  contractorId?: string;
  residentId?: string;
  sla?: "breached" | "at_risk";
  page?: number;
  pageSize?: number;
}

function scopeForUser(user: SessionUser): Prisma.TicketWhereInput {
  if (user.role === "TECHNICIAN") return { technicianId: user.technicianId ?? "__none__" };
  if (user.role === "CONTRACTOR") return { contractorId: user.contractorId ?? "__none__" };
  if (user.role === "RESIDENT") return { residentId: user.residentId ?? "__none__" };
  return {};
}

export async function listTickets(user: SessionUser, f: TicketFilters = {}) {
  const now = new Date();
  const where: Prisma.TicketWhereInput = { AND: [scopeForUser(user)] };
  const and = where.AND as Prisma.TicketWhereInput[];
  if (f.status === "open") and.push({ status: { in: OPEN_STATUSES } });
  else if (f.status === "closed") and.push({ status: { in: ["COMPLETED", "CLOSED", "CANCELLED"] } });
  else if (f.status) and.push({ status: f.status as TicketStatus });
  if (f.priority) and.push({ priority: f.priority as Prisma.EnumPriorityFilter["equals"] });
  if (f.category) and.push({ category: { key: f.category } });
  if (f.technicianId) and.push({ technicianId: f.technicianId });
  if (f.contractorId) and.push({ contractorId: f.contractorId });
  if (f.residentId) and.push({ residentId: f.residentId });
  if (f.sla === "breached") {
    and.push({
      OR: [
        { slaResponseBreached: true },
        { slaResolutionBreached: true },
        { status: { in: OPEN_STATUSES }, completedAt: null, slaResolutionDueAt: { lt: now } },
      ],
    });
  }
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { ticketNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { unit: { code: { contains: q, mode: "insensitive" } } },
        { resident: { name: { contains: q, mode: "insensitive" } } },
        { resident: { nameAr: { contains: q } } },
      ],
    });
  }
  const pageSize = Math.min(100, f.pageSize ?? 25);
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { key: true, nameEn: true, nameAr: true } },
        unit: { select: { code: true } },
        resident: { select: { name: true, nameAr: true } },
        technician: { select: { name: true, nameAr: true } },
        contractor: { select: { name: true, nameAr: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      source: t.source,
      category: t.category,
      unit: t.unit?.code ?? null,
      resident: t.resident,
      assignee: t.technician ?? t.contractor ?? null,
      assigneeType: t.technician ? "TECHNICIAN" : t.contractor ? "CONTRACTOR" : null,
      createdAt: t.createdAt.toISOString(),
      sla: serializeSla(t, now),
    })),
  };
}

type SlaFields = Pick<
  Prisma.TicketGetPayload<object>,
  "createdAt" | "slaResponseDueAt" | "slaResolutionDueAt" | "acknowledgedAt" | "completedAt" | "cancelledAt" | "status"
>;

export function serializeSla(t: SlaFields, now = new Date()) {
  const s = getSlaStatus({ ...t, cancelledAt: t.cancelledAt, now });
  return {
    overall: t.status === "CANCELLED" ? ("NONE" as const) : s.overall,
    breached: s.breached,
    responseState: s.response.state,
    resolutionState: s.resolution.state,
    responseDueAt: t.slaResponseDueAt?.toISOString() ?? null,
    resolutionDueAt: t.slaResolutionDueAt?.toISOString() ?? null,
    responseRemainingMs: s.response.remainingMs,
    resolutionRemainingMs: s.resolution.remainingMs,
    timeToAcknowledgeMs: t.acknowledgedAt ? s.response.elapsedMs : null,
    timeToResolutionMs: t.completedAt ? s.resolution.elapsedMs : null,
    resolutionConsumed: s.resolution.consumed,
  };
}
export type SlaDTO = ReturnType<typeof serializeSla>;
export type TicketListResult = Awaited<ReturnType<typeof listTickets>>;
export type TicketRow = TicketListResult["rows"][number];

export async function getTicketDetail(id: string, user: SessionUser) {
  const t = await db.ticket.findFirst({
    where: { id, AND: [scopeForUser(user)] },
    include: {
      category: true,
      compound: { select: { name: true, nameAr: true } },
      resident: true,
      unit: { include: { building: { select: { code: true } } } },
      asset: { include: { history: { orderBy: { date: "desc" }, take: 20 } } },
      technician: true,
      contractor: true,
      team: true,
      events: { orderBy: { createdAt: "asc" } },
      aiAnalyses: { orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      quotations: { orderBy: { createdAt: "desc" }, include: { items: true } },
    },
  });
  if (!t) return null;
  const suggested = t.suggestedContractorId ? await db.contractor.findUnique({ where: { id: t.suggestedContractorId } }) : null;
  const isAssignee =
    (!!user.technicianId && user.technicianId === t.technicianId) || (!!user.contractorId && user.contractorId === t.contractorId);
  const actions = availableActions(t.status as TicketStatus, user.role, isAssignee);
  const manager = isManager(user.role);
  const recommendation =
    manager && t.category && !["CLOSED", "CANCELLED", "COMPLETED"].includes(t.status)
      ? await getAssignmentRecommendation(t.category.key, t.category.requiredSkill)
      : null;

  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    title: t.title,
    description: t.description,
    location: t.location,
    status: t.status,
    priority: t.priority,
    aiSuggestedPriority: t.aiSuggestedPriority,
    priorityOverridden: t.priorityOverridden,
    source: t.source,
    requiresQuotation: t.requiresQuotation,
    createdAt: t.createdAt.toISOString(),
    assignedAt: t.assignedAt?.toISOString() ?? null,
    acknowledgedAt: t.acknowledgedAt?.toISOString() ?? null,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    residentConfirmedAt: t.residentConfirmedAt?.toISOString() ?? null,
    estimatedCost: num(t.estimatedCost),
    approvedCost: num(t.approvedCost),
    finalCost: num(t.finalCost),
    resolutionNotes: t.resolutionNotes,
    compound: t.compound,
    category: t.category ? { key: t.category.key, nameEn: t.category.nameEn, nameAr: t.category.nameAr, requiredSkill: t.category.requiredSkill } : null,
    resident: t.resident ? { id: t.resident.id, name: t.resident.name, nameAr: t.resident.nameAr, phone: t.resident.phone, language: t.resident.language } : null,
    unit: t.unit ? { code: t.unit.code, floor: t.unit.floor, building: t.unit.building.code } : null,
    asset: t.asset
      ? {
          id: t.asset.id,
          assetCode: t.asset.assetCode,
          name: t.asset.name,
          nameAr: t.asset.nameAr,
          type: t.asset.type,
          location: t.asset.location,
          status: t.asset.status,
          history: t.asset.history.map((h) => ({ id: h.id, date: h.date.toISOString(), type: h.type, description: h.description, cost: num(h.cost), performedBy: h.performedBy, ticketId: h.ticketId })),
        }
      : null,
    technician: t.technician ? { id: t.technician.id, name: t.technician.name, nameAr: t.technician.nameAr, phone: t.technician.phone } : null,
    contractor: t.contractor ? { id: t.contractor.id, name: t.contractor.name, nameAr: t.contractor.nameAr, phone: t.contractor.phone } : null,
    suggestedContractor: suggested ? { id: suggested.id, name: suggested.name, nameAr: suggested.nameAr } : null,
    team: t.team ? { name: t.team.name, nameAr: t.team.nameAr } : null,
    sla: serializeSla(t),
    analyses: t.aiAnalyses.map((a) => ({
      id: a.id,
      provider: a.provider,
      model: a.model,
      input: a.input,
      language: a.language,
      categoryKey: a.categoryKey,
      priority: a.priority,
      issue: a.issue,
      location: a.location,
      assetHint: a.assetHint,
      confidence: a.confidence,
      recommendedAction: a.recommendedAction,
      reasoning: a.reasoning,
      entities: a.entities as Record<string, unknown> | null,
      needsMoreInfo: a.needsMoreInfo,
      followUpQuestion: a.followUpQuestion,
      latencyMs: a.latencyMs,
      fallbackUsed: a.fallbackUsed,
      edited: !!a.editedAt,
      createdAt: a.createdAt.toISOString(),
    })),
    events: t.events.map((e) => ({ id: e.id, type: e.type, actorType: e.actorType, actorName: e.actorName, message: e.message, data: e.data as Record<string, unknown> | null, createdAt: e.createdAt.toISOString() })),
    messages: t.messages.map((m) => ({ id: m.id, direction: m.direction, channel: m.channel, senderType: m.senderType, senderName: m.senderName, body: m.body, mediaType: m.mediaType, mediaUrl: m.mediaUrl, transcript: m.transcript, status: m.status, createdAt: m.createdAt.toISOString() })),
    attachments: t.attachments.map((a) => ({ id: a.id, type: a.type, url: a.url, fileName: a.fileName, mimeType: a.mimeType, size: a.size, analysis: a.analysis as Record<string, unknown> | null, createdAt: a.createdAt.toISOString() })),
    quotations: t.quotations.map((q) => ({
      id: q.id,
      number: q.number,
      version: q.version,
      status: q.status,
      createdByName: q.createdByName,
      laborCost: Number(q.laborCost),
      materialsCost: Number(q.materialsCost),
      subtotal: Number(q.subtotal),
      vatRate: Number(q.vatRate),
      vatAmount: Number(q.vatAmount),
      total: Number(q.total),
      estimatedHours: q.estimatedHours,
      estimatedCompletionAt: q.estimatedCompletionAt?.toISOString() ?? null,
      notes: q.notes,
      reviewedByName: q.reviewedByName,
      reviewedAt: q.reviewedAt?.toISOString() ?? null,
      reviewNotes: q.reviewNotes,
      createdAt: q.createdAt.toISOString(),
      items: q.items.map((i) => ({ id: i.id, type: i.type, description: i.description, quantity: i.quantity, unitPrice: Number(i.unitPrice), total: Number(i.total) })),
    })),
    actions,
    isAssignee,
    recommendation: recommendation
      ? {
          strategy: recommendation.strategy,
          reason: recommendation.reason,
          technicians: recommendation.rankedTechnicians.slice(0, 6).map((r) => ({
            id: r.technician.id,
            name: r.technician.name,
            score: r.score,
            eligible: r.eligible,
            reasons: r.reasons,
            openTickets: r.technician.openTickets,
          })),
          contractors: recommendation.rankedContractors.filter((c) => c.eligible).slice(0, 4).map((r) => ({
            id: r.contractor.id,
            name: r.contractor.name,
            score: r.score,
            reasons: r.reasons,
          })),
        }
      : null,
  };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;

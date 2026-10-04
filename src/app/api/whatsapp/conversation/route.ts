import { requireApiUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/server/http/api";
import { AppError, NotFoundError } from "@/server/services/errors";
import { serializeSla } from "@/server/services/query.service";

/** Simulator read model: chat history + live AI/ticket state for one resident. */
export const GET = route(async (req) => {
  await requireApiUser(MANAGERS);
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) throw new AppError("residentId is required");
  const resident = await db.resident.findUnique({ where: { id: residentId }, include: { unit: true } });
  if (!resident) throw new NotFoundError("Resident");
  const conversation = await db.conversation.findFirst({ where: { residentId } });
  const messages = conversation
    ? await db.ticketMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 200, include: { attachments: true } })
    : [];
  const tickets = await db.ticket.findMany({
    where: { residentId },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: {
      category: true,
      technician: true,
      contractor: true,
      asset: true,
      aiAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
      events: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  return {
    resident: { id: resident.id, name: resident.name, nameAr: resident.nameAr, phone: resident.phone, unit: resident.unit.code, language: resident.language },
    conversation: conversation ? { state: conversation.state, activeTicketId: conversation.activeTicketId } : null,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      mediaType: m.mediaType,
      mediaUrl: m.mediaUrl,
      transcript: m.transcript,
      status: m.status,
      ticketId: m.ticketId,
      createdAt: m.createdAt.toISOString(),
      analysis: m.attachments[0]?.analysis ?? null,
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      aiSuggestedPriority: t.aiSuggestedPriority,
      category: t.category ? { key: t.category.key, nameEn: t.category.nameEn, nameAr: t.category.nameAr } : null,
      assignee: t.technician?.name ?? t.contractor?.name ?? null,
      asset: t.asset?.assetCode ?? null,
      location: t.location,
      createdAt: t.createdAt.toISOString(),
      sla: serializeSla(t),
      analysis: t.aiAnalyses[0]
        ? {
            provider: t.aiAnalyses[0].provider,
            issue: t.aiAnalyses[0].issue,
            location: t.aiAnalyses[0].location,
            confidence: t.aiAnalyses[0].confidence,
            recommendedAction: t.aiAnalyses[0].recommendedAction,
            reasoning: t.aiAnalyses[0].reasoning,
            followUpQuestion: t.aiAnalyses[0].followUpQuestion,
            priority: t.aiAnalyses[0].priority,
            latencyMs: t.aiAnalyses[0].latencyMs,
            fallbackUsed: t.aiAnalyses[0].fallbackUsed,
            entities: t.aiAnalyses[0].entities,
          }
        : null,
      events: t.events.map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
    })),
  };
});

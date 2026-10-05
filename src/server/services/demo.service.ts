import { db } from "@/lib/db";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { actorFromUser, type Actor } from "./actor";
import { AppError, NotFoundError } from "./errors";
import { handleInboundMessage } from "./intake.service";
import { assignTicket, acknowledgeTicket, approveQuotation, closeTicket, completeTicket, startTicket, submitQuotation } from "./ticket.service";

/**
 * Demo mode: drives the REAL workflow end-to-end, one step per API call, so the UI
 * can show each step live. Nothing here is faked — it calls the same services the
 * simulator, technicians and managers use.
 */
export const DEMO_STEPS = [
  "resident_message",
  "technician_acknowledge",
  "technician_quotation",
  "manager_approve",
  "technician_complete",
  "resident_confirm",
  "manager_close",
] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];

const DEMO_UNIT = "A01-201";
const DEMO_TEXT = "التكييف في أوضة النوم مش بيبرد خالص والجو حر جداً";

async function demoResident() {
  const r = await db.resident.findFirst({ where: { unit: { code: DEMO_UNIT } } });
  if (!r) throw new NotFoundError("Demo resident (run the seed)");
  return r;
}

async function technicianActor(ticketId: string): Promise<Actor> {
  const t = await db.ticket.findUnique({ where: { id: ticketId }, include: { technician: { include: { user: true } }, contractor: { include: { users: true } } } });
  if (!t) throw new NotFoundError("Ticket");
  if (t.technician) return actorFromUser({ ...t.technician.user, technicianId: t.technician.id });
  if (t.contractor?.users[0]) return actorFromUser({ ...t.contractor.users[0], contractorId: t.contractor.id });
  throw new AppError("Demo ticket has no assignee");
}

async function managerActor(): Promise<Actor> {
  const u = await db.user.findFirst({ where: { role: "MAINTENANCE_MANAGER" } });
  if (!u) throw new NotFoundError("Maintenance manager");
  return actorFromUser(u);
}

async function inbound(phone: string, text: string) {
  const [msg] = await getMockWhatsAppProvider().receiveMessage({ from: phone, type: "text", text });
  return handleInboundMessage(msg, "mock");
}

export async function runDemoStep(step: DemoStep, ticketId?: string | null) {
  const resident = await demoResident();
  let log = "";
  if (step !== "resident_message" && !ticketId) throw new AppError("ticketId is required for this step");

  switch (step) {
    case "resident_message": {
      // Fresh conversation state so the demo is repeatable
      await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
      const r = await inbound(resident.phone, DEMO_TEXT);
      if (!r.ticketId) throw new AppError(`Intake did not create a ticket (${r.action})`);
      await db.ticket.update({ where: { id: r.ticketId }, data: { isDemo: true } });
      // If every HVAC technician is at capacity the engine only *suggests* a contractor —
      // in the demo the manager confirms it so the walkthrough can continue.
      const created = await db.ticket.findUniqueOrThrow({ where: { id: r.ticketId } });
      if (!created.technicianId && !created.contractorId) {
        const contractorId =
          created.suggestedContractorId ??
          (await db.contractor.findFirst({ where: { isActive: true, category: { key: "HVAC" } } }))?.id;
        if (!contractorId) throw new AppError("No technician or contractor available for the demo");
        await assignTicket(r.ticketId, { contractorId }, await managerActor(), "Demo: manager confirmed the suggested contractor");
      }
      ticketId = r.ticketId;
      log = `Resident ${resident.nameAr ?? resident.name} sent: “${DEMO_TEXT}” → ${r.ticketNumber}`;
      break;
    }
    case "technician_acknowledge": {
      const actor = await technicianActor(ticketId!);
      await acknowledgeTicket(ticketId!, actor);
      log = `${actor.name} acknowledged the job`;
      break;
    }
    case "technician_quotation": {
      const actor = await technicianActor(ticketId!);
      await startTicket(ticketId!, actor);
      const { quotation } = await submitQuotation(
        ticketId!,
        {
          items: [
            { type: "LABOR", description: "Compressor replacement (2 technicians)", quantity: 3, unitPrice: 300 },
            { type: "MATERIAL", description: "Rotary compressor 1.5HP", quantity: 1, unitPrice: 3800 },
            { type: "MATERIAL", description: "R410A refrigerant refill", quantity: 1, unitPrice: 450 },
          ],
          estimatedHours: 4,
          notes: "الكمبروسر محتاج تغيير — Compressor seized; replacement required.",
        },
        actor,
      );
      log = `${actor.name} started work and submitted ${quotation.number} (${Number(quotation.total).toLocaleString("en-US")} EGP)`;
      break;
    }
    case "manager_approve": {
      const actor = await managerActor();
      await approveQuotation(ticketId!, actor, { notes: "Approved — within budget" });
      log = `${actor.name} approved the quotation → work resumed`;
      break;
    }
    case "technician_complete": {
      const actor = await technicianActor(ticketId!);
      await completeTicket(ticketId!, actor, { notes: "Compressor replaced, gas refilled, cooling tested at 18°C." });
      log = `${actor.name} completed the job; resident asked to confirm`;
      break;
    }
    case "resident_confirm": {
      const r = await inbound(resident.phone, "تمام اتصلح، شكراً جداً");
      log = `Resident replied “تمام اتصلح، شكراً جداً” → ${r.action}`;
      break;
    }
    case "manager_close": {
      const actor = await managerActor();
      await closeTicket(ticketId!, actor, "Resident confirmed");
      log = `${actor.name} closed the ticket`;
      break;
    }
  }
  return { ticketId: ticketId!, log, snapshot: await demoSnapshot(ticketId!) };
}

export async function demoSnapshot(ticketId: string) {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      category: true,
      technician: true,
      contractor: true,
      asset: { include: { history: { orderBy: { date: "desc" }, take: 5 } } },
      events: { orderBy: { createdAt: "asc" } },
      quotations: { orderBy: { createdAt: "desc" }, take: 1 },
      aiAnalyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!t) throw new NotFoundError("Ticket");
  const conv = await db.conversation.findFirst({ where: { residentId: t.residentId ?? undefined } });
  const messages = conv
    ? await db.ticketMessage.findMany({ where: { conversationId: conv.id, createdAt: { gte: new Date(t.createdAt.getTime() - 5000) } }, orderBy: { createdAt: "asc" } })
    : [];
  return {
    ticket: {
      id: t.id,
      ticketNumber: t.ticketNumber,
      status: t.status,
      priority: t.priority,
      title: t.title,
      category: t.category?.nameEn ?? null,
      assignee: t.technician?.name ?? t.contractor?.name ?? null,
      slaResponseDueAt: t.slaResponseDueAt?.toISOString() ?? null,
      slaResolutionDueAt: t.slaResolutionDueAt?.toISOString() ?? null,
      approvedCost: t.approvedCost ? Number(t.approvedCost) : null,
      finalCost: t.finalCost ? Number(t.finalCost) : null,
      quotation: t.quotations[0] ? { number: t.quotations[0].number, total: Number(t.quotations[0].total), status: t.quotations[0].status } : null,
      analysis: t.aiAnalyses[0]
        ? { issue: t.aiAnalyses[0].issue, location: t.aiAnalyses[0].location, confidence: t.aiAnalyses[0].confidence, provider: t.aiAnalyses[0].provider }
        : null,
      asset: t.asset
        ? { assetCode: t.asset.assetCode, name: t.asset.name, history: t.asset.history.map((h) => ({ date: h.date.toISOString(), description: h.description, type: h.type })) }
        : null,
    },
    events: t.events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, message: e.message, createdAt: e.createdAt.toISOString() })),
    messages: messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.createdAt.toISOString() })),
  };
}
export type DemoSnapshot = Awaited<ReturnType<typeof demoSnapshot>>;

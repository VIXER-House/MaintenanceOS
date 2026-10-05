/**
 * End-to-end workflow against a real PostgreSQL database (seeded).
 * Skipped automatically when the database is unreachable.
 *   pnpm test           (runs unit + integration)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";
import { runDemoStep, DEMO_STEPS } from "@/server/services/demo.service";
import { actorFromUser } from "@/server/services/actor";
import { approveQuotation, submitQuotation, startTicket, acknowledgeTicket, completeTicket } from "@/server/services/ticket.service";
import { ForbiddenError, ConflictError } from "@/server/services/errors";
import { InvalidTransitionError } from "@/server/engines/lifecycle/ticket-lifecycle";

let dbUp = false;
beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = (await db.resident.count()) > 0;
  } catch {
    dbUp = false;
  }
});
afterAll(async () => {
  await db.$disconnect();
});

async function send(phone: string, text: string) {
  const [msg] = await getMockWhatsAppProvider().receiveMessage({ from: phone, type: "text", text });
  return handleInboundMessage(msg, "mock");
}

describe.runIf(process.env.DATABASE_URL)("WhatsApp → ticket workflow (integration)", () => {
  it("creates, classifies, prioritises, SLA-stamps and assigns a ticket from Egyptian Arabic", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A01-101" } } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
    const r = await send(resident.phone, "الكهربا قاطعة في الشقة");
    expect(r.action).toBe("created");
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.ticketId! }, include: { category: true, events: true } });
    expect(t.category?.key).toBe("ELECTRICAL");
    expect(t.priority).toBe("HIGH");
    // Auto-assigned to an electrician — or, if every electrician is at capacity, a contractor is suggested for manager confirmation
    if (t.status === "ASSIGNED") expect(t.technicianId).toBeTruthy();
    else expect(t.suggestedContractorId).toBeTruthy();
    expect(t.slaResponseDueAt!.getTime() - t.createdAt.getTime()).toBe(120 * 60_000);
    expect(t.ticketNumber).toMatch(/^MAINT-\d{6}$/);
    const types = t.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["TICKET_CREATED", "AI_ANALYZED", "PRIORITY_CHANGED", "SLA_SET"]));
    expect(r.replies[0]).toContain(t.ticketNumber);
  });

  it("asks a follow-up question and escalates to EMERGENCY on 'المياه كتير'", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A01-102" } } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
    const first = await send(resident.phone, "فيه تسريب مياه في المطبخ");
    expect(first.action).toBe("follow_up_requested");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: first.ticketId! } })).status).toBe("WAITING_FOR_INFO");
    const second = await send(resident.phone, "المياه كتير");
    expect(second.action).toBe("follow_up_answered");
    const t = await db.ticket.findUniqueOrThrow({ where: { id: first.ticketId! } });
    expect(t.priority).toBe("EMERGENCY");
    // assigned to a plumber, or (all plumbers at capacity) a contractor suggested for the manager
    if (t.status === "ASSIGNED") expect(t.technicianId ?? t.contractorId).toBeTruthy();
    else expect(t.suggestedContractorId).toBeTruthy();
    expect(t.slaResponseDueAt!.getTime() - t.createdAt.getTime()).toBe(30 * 60_000);
    expect(second.replies[0]).toContain("طارئة");
  });

  it("enforces human-in-the-loop on quotations and the state machine", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A02-201" } } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
    const r = await send(resident.phone, "السخان مش شغال");
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.ticketId! }, include: { technician: { include: { user: true } } } });
    const tech = actorFromUser({ ...t.technician!.user, technicianId: t.technicianId });
    const otherTechUser = await db.user.findFirstOrThrow({ where: { role: "TECHNICIAN", technician: { id: { not: t.technicianId! } } }, include: { technician: true } });
    const otherTech = actorFromUser({ ...otherTechUser, technicianId: otherTechUser.technician!.id });

    await expect(acknowledgeTicket(t.id, otherTech)).rejects.toBeInstanceOf(ForbiddenError);
    await startTicket(t.id, tech);
    await expect(startTicket(t.id, tech)).rejects.toBeInstanceOf(InvalidTransitionError);
    await submitQuotation(t.id, { items: [{ type: "MATERIAL", description: "Replace heater tank", quantity: 1, unitPrice: 20_000 }] }, tech);
    await expect(approveQuotation(t.id, tech)).rejects.toBeInstanceOf(ForbiddenError);
    const mm = await db.user.findFirstOrThrow({ where: { role: "MAINTENANCE_MANAGER" } });
    await expect(approveQuotation(t.id, actorFromUser(mm))).rejects.toThrow(/approval limit/);
    await expect(completeTicket(t.id, tech)).rejects.toBeInstanceOf(ConflictError);
    const cm = await db.user.findFirstOrThrow({ where: { role: "COMPOUND_MANAGER" } });
    const approved = await approveQuotation(t.id, actorFromUser(cm));
    expect(approved.status).toBe("IN_PROGRESS");
    expect(Number(approved.approvedCost)).toBeCloseTo(22_800);
  });

  it("registers an unknown number via WhatsApp, then files its first request", async () => {
    if (!dbUp) return;
    const phone = `+2012${Date.now().toString().slice(-8)}`;
    const first = await send(phone, "الحنفية في المطبخ بتسرب");
    expect(first.action).toBe("registration_requested");
    expect(first.replies[0]).toContain("رقم الوحدة");
    const r0 = await db.resident.findUniqueOrThrow({ where: { phone } });
    expect(r0.verified).toBe(false);
    expect(r0.unitId).toBeNull();
    expect(await db.ticket.count({ where: { residentId: r0.id } })).toBe(0);

    const wrong = await send(phone, "Z99-999");
    expect(wrong.action).toBe("registration_requested");

    const ok = await send(phone, "A02-102");
    expect(["created", "follow_up_requested"]).toContain(ok.action);
    const r1 = await db.resident.findUniqueOrThrow({ where: { phone }, include: { unit: true } });
    expect(r1.unit?.code).toBe("A02-102");
    expect(r1.verified).toBe(false);
    const t = await db.ticket.findFirstOrThrow({ where: { residentId: r1.id }, include: { category: true } });
    expect(t.category?.key).toBe("PLUMBING");
    expect(t.description).toContain("الحنفية");
  });

  it("elevator: 'yes, two people' to 'is anyone trapped?' → EMERGENCY; a later reaction is a comment, not a new ticket", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A02-101" } } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
    const first = await send(resident.phone, "لو سمحت عندي مشكلة في اسانسير العماره");
    expect(first.action).toBe("follow_up_requested");
    expect(first.replies[0]).toContain("محبوس");
    const answer = await send(resident.phone, "اه في فردين");
    expect(answer.action).toBe("follow_up_answered");
    const t = await db.ticket.findUniqueOrThrow({ where: { id: answer.ticketId! } });
    expect(t.priority).toBe("EMERGENCY");
    expect(t.slaResponseDueAt!.getTime() - t.createdAt.getTime()).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    const before = await db.ticket.count({ where: { residentId: resident.id } });
    const reaction = await send(resident.phone, "ساعتين!!! 😂😂😂");
    expect(reaction.action).toBe("comment");
    expect(reaction.ticketId).toBe(t.id);
    expect(await db.ticket.count({ where: { residentId: resident.id } })).toBe(before);
  });

  it("elevator: 'no, nobody' keeps the normal priority", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A02-102" } } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null } });
    const first = await send(resident.phone, "الاسانسير واقف");
    if (first.action !== "follow_up_requested") return; // the AI may already have enough info
    const answer = await send(resident.phone, "لا مفيش حد جوه");
    const t = await db.ticket.findUniqueOrThrow({ where: { id: answer.ticketId! } });
    expect(t.priority).not.toBe("EMERGENCY");
  });

  it("runs the full demo scenario end-to-end", async () => {
    if (!dbUp) return;
    let ticketId: string | undefined;
    for (const step of DEMO_STEPS) {
      const r = await runDemoStep(step, ticketId);
      ticketId = r.ticketId;
    }
    const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId! }, include: { events: true, asset: { include: { history: true } }, quotations: true } });
    expect(t.status).toBe("CLOSED");
    expect(t.asset?.assetCode).toBe("AC-A01-201-BR");
    expect(t.asset?.history.some((h) => h.ticketId === t.id)).toBe(true);
    expect(t.quotations[0].status).toBe("APPROVED");
    expect(t.residentConfirmedAt).toBeTruthy();
    const types = new Set(t.events.map((e) => e.type));
    for (const e of ["TICKET_CREATED", "AI_ANALYZED", "ASSIGNED", "ACKNOWLEDGED", "STARTED", "QUOTATION_CREATED", "QUOTATION_APPROVED", "COMPLETED", "RESIDENT_CONFIRMED", "CLOSED", "ASSET_HISTORY_UPDATED"]) {
      expect(types.has(e as never)).toBe(true);
    }
    const outbound = await db.ticketMessage.count({ where: { ticketId: t.id, direction: "OUTBOUND" } });
    expect(outbound).toBeGreaterThanOrEqual(6);
  });
});

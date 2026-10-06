/** Technician WhatsApp: job offers, accept/decline by reply, auto-reassign, reminders, reassignment notices. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";
import { assignTicket, declineAssignment, getTicketOrThrow } from "@/server/services/ticket.service";
import { createRecord } from "@/server/services/manage.service";
import { sweepSlaBreaches } from "@/server/services/sla.service";
import { invalidateCategoryCatalog } from "@/server/services/category-catalog.service";
import type { Actor } from "@/server/services/actor";

let dbUp = false;
let manager: Actor;
const T = `W${Date.now().toString().slice(-5)}`;
const tail = Date.now().toString().slice(-4);

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = (await db.technician.count()) > 0;
  } catch {
    dbUp = false;
  }
  if (!dbUp) return;
  const mm = await db.user.findFirstOrThrow({ where: { role: "MAINTENANCE_MANAGER" } });
  manager = { type: "STAFF", name: mm.name, userId: mm.id, role: mm.role };
});
afterAll(async () => {
  if (dbUp) {
    const cat = await db.category.findUnique({ where: { key: `${T}_CAT` } });
    if (cat) {
      const tks = await db.ticket.findMany({ where: { categoryId: cat.id }, select: { id: true } });
      await db.conversation.updateMany({ where: { activeTicketId: { in: tks.map((t) => t.id) } }, data: { activeTicketId: null } });
      await db.ticketMessage.deleteMany({ where: { ticketId: { in: tks.map((t) => t.id) } } });
      await db.ticket.deleteMany({ where: { id: { in: tks.map((t) => t.id) } } });
    }
    const techs = await db.technician.findMany({ where: { name: { startsWith: T } } });
    await db.technician.deleteMany({ where: { id: { in: techs.map((t) => t.id) } } });
    await db.notification.deleteMany({ where: { userId: { in: techs.map((t) => t.userId) } } });
    await db.user.deleteMany({ where: { id: { in: techs.map((t) => t.userId) } } });
    if (cat) await db.category.delete({ where: { id: cat.id } });
    invalidateCategoryCatalog();
  }
  await db.$disconnect();
});

async function fromPhone(phone: string, text: string) {
  const [m] = await getMockWhatsAppProvider().receiveMessage({ from: phone, type: "text", text });
  return handleInboundMessage(m, "mock");
}
const staffMsgs = (phone: string) => db.ticketMessage.findMany({ where: { toPhone: phone }, orderBy: { createdAt: "asc" } });

describe.runIf(process.env.DATABASE_URL)("technician WhatsApp flow (integration)", () => {
  let catKey = "";
  let a: { id: string; phone: string; name: string };
  let b: { id: string; phone: string; name: string };

  it("setup: a category with two technicians", async () => {
    if (!dbUp) return;
    const cat = (await createRecord("categories", { key: `${T}_CAT`, nameEn: "Intercom", nameAr: "الانتركم", description: "Door intercom", keywords: ["انتركم", "الانتركم", "intercom"] }, manager)) as { key: string };
    catKey = cat.key;
    a = (await createRecord("technicians", { name: `${T} Alaa`, phone: `01155${tail}01`, skills: [catKey] }, manager)) as typeof a;
    b = (await createRecord("technicians", { name: `${T} Bassem`, phone: `01155${tail}02`, skills: [catKey], maxConcurrent: 4 }, manager)) as typeof b;
    expect(a.phone).toBe(`+201155${tail}01`);
  });

  it("assignment sends a WhatsApp job offer; “1” accepts it", async () => {
    if (!dbUp) return;
    const resident = await db.resident.findFirstOrThrow({ where: { unit: { code: "A03-202" }, isActive: true } });
    await db.conversation.updateMany({ where: { residentId: resident.id }, data: { state: "IDLE", activeTicketId: null, context: {} } });
    const r = await handleInboundMessage((await getMockWhatsAppProvider().receiveMessage({ from: resident.phone, type: "text", text: "الانتركم بايظ مش بيرن" }))[0], "mock", { skipDuplicateCheck: true });
    const t = await getTicketOrThrow(r.ticketId!);
    expect(t.category?.key).toBe(catKey);
    const assignee = [a, b].find((x) => x.id === t.technicianId)!;
    expect(assignee).toBeTruthy();
    const offer = (await staffMsgs(assignee.phone)).at(-1)!;
    expect(offer.body).toContain(t.ticketNumber);
    expect(offer.body).toContain("رد بـ 1");
    expect(offer.ticketId).toBe(t.id);

    const ok = await fromPhone(assignee.phone, "1");
    expect(ok.action).toBe("staff");
    const after = await getTicketOrThrow(t.id);
    expect(after.status).toBe("ACKNOWLEDGED");
    expect((await staffMsgs(assignee.phone)).at(-1)!.body).toContain("قبولك");
  });

  it("“2” needs a reason; with a reason the job moves to the other technician", async () => {
    if (!dbUp) return;
    const t0 = await db.ticket.findFirstOrThrow({ where: { category: { key: catKey } }, orderBy: { createdAt: "desc" } });
    // fresh assignment to Alaa
    await assignTicket(t0.id, { technicianId: a.id }, manager);
    const noReason = await fromPhone(a.phone, "2");
    expect(noReason.replies[0]).toContain("السبب");
    expect((await getTicketOrThrow(t0.id)).technicianId).toBe(a.id);

    await fromPhone(a.phone, "2 عندي ظرف عائلي");
    const t = await getTicketOrThrow(t0.id);
    expect(t.technicianId).toBe(b.id);
    expect(t.status).toBe("ASSIGNED");
    expect(t.declinedTechnicianIds).toContain(a.id);
    const ev = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: t.id, type: "DECLINED" } });
    expect(ev.message).toContain("عندي ظرف عائلي");
    expect((await staffMsgs(b.phone)).at(-1)!.body).toContain(t.ticketNumber);
    expect((await staffMsgs(a.phone)).at(-1)!.body).toMatch(/اعتذارك|اتحول/);
  });

  it("when nobody else is free the job waits for a manager", async () => {
    if (!dbUp) return;
    const t0 = await db.ticket.findFirstOrThrow({ where: { category: { key: catKey } }, orderBy: { createdAt: "desc" } });
    const bActor: Actor = { type: "TECHNICIAN", name: b.name, technicianId: b.id, role: "TECHNICIAN" };
    // Everyone else (incl. general handymen) is busy today
    const others = await db.technician.findMany({ where: { isActive: true, id: { notIn: [a.id, b.id] } }, select: { id: true } });
    await db.technician.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    let r: Awaited<ReturnType<typeof declineAssignment>>;
    try {
      r = await declineAssignment(t0.id, bActor, "العربية عطلانة");
    } finally {
      await db.technician.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
    expect(r.reassignedTo).toBeNull();
    const t = await getTicketOrThrow(t0.id);
    expect(t.status).toBe("NEW");
    expect(t.technicianId).toBeNull();
    expect(await db.notification.count({ where: { ticketId: t.id, title: { contains: "no technician available" } } })).toBeGreaterThan(0);
  });

  it("silent assignee gets one reminder; managers are told", async () => {
    if (!dbUp) return;
    const t0 = await db.ticket.findFirstOrThrow({ where: { category: { key: catKey } }, orderBy: { createdAt: "desc" } });
    await assignTicket(t0.id, { technicianId: a.id }, manager);
    await db.ticket.update({ where: { id: t0.id }, data: { assignedAt: new Date(Date.now() - 3 * 3600_000), slaResponseDueAt: new Date(Date.now() + 3600_000) } });
    await sweepSlaBreaches(true);
    await sweepSlaBreaches(true);
    expect(await db.ticketEvent.count({ where: { ticketId: t0.id, type: "REMINDER_SENT" } })).toBe(1);
    expect((await staffMsgs(a.phone)).at(-1)!.body).toContain("تذكير");
  });

  it("manual reassignment tells the previous technician", async () => {
    if (!dbUp) return;
    const t0 = await db.ticket.findFirstOrThrow({ where: { category: { key: catKey } }, orderBy: { createdAt: "desc" } });
    await assignTicket(t0.id, { technicianId: b.id }, manager);
    expect((await staffMsgs(a.phone)).at(-1)!.body).toContain("اتحول لزميل");
    expect((await staffMsgs(b.phone)).at(-1)!.body).toContain("رد بـ 1");
    expect((await getTicketOrThrow(t0.id)).assignReminderAt).toBeNull();
  });

  it("archived technicians can't be assigned", async () => {
    if (!dbUp) return;
    const t0 = await db.ticket.findFirstOrThrow({ where: { category: { key: catKey } }, orderBy: { createdAt: "desc" } });
    await db.technician.update({ where: { id: a.id }, data: { isActive: false } });
    await expect(assignTicket(t0.id, { technicianId: a.id }, manager)).rejects.toThrow(/archived/);
  });
});

/** Unverified numbers, unit alerts, fake reports (technician / unit resident) and blocked numbers. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";
import { assignTicket, getTicketOrThrow } from "@/server/services/ticket.service";
import { createRecord } from "@/server/services/manage.service";
import { invalidateCategoryCatalog } from "@/server/services/category-catalog.service";
import { reportFakeTicket, resolveFakeReport, unblockPhone } from "@/server/services/fake-report.service";
import type { Actor } from "@/server/services/actor";

let dbUp = false;
let manager: Actor;
const T = `F${Date.now().toString().slice(-5)}`;
const tail = Date.now().toString().slice(-4);
const stranger = `+201166${tail}77`;
const UNIT = "A03-202";

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = (await db.technician.count()) > 0 && !!(await db.unit.findUnique({ where: { code: UNIT } }));
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
    const strangerRes = await db.resident.findUnique({ where: { phone: stranger } });
    const tks = await db.ticket.findMany({ where: { OR: [...(cat ? [{ categoryId: cat.id }] : []), ...(strangerRes ? [{ residentId: strangerRes.id }] : [])] }, select: { id: true } });
    const ids = tks.map((t) => t.id);
    await db.conversation.updateMany({ where: { activeTicketId: { in: ids } }, data: { activeTicketId: null } });
    await db.ticketMessage.deleteMany({ where: { OR: [{ ticketId: { in: ids } }, { toPhone: stranger }] } });
    await db.ticket.deleteMany({ where: { id: { in: ids } } });
    if (strangerRes) {
      const convs = await db.conversation.findMany({ where: { residentId: strangerRes.id }, select: { id: true } });
      await db.ticketMessage.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
      await db.conversation.deleteMany({ where: { residentId: strangerRes.id } });
      await db.resident.delete({ where: { id: strangerRes.id } });
    }
    await db.blockedPhone.deleteMany({ where: { phone: stranger } });
    const techs = await db.technician.findMany({ where: { name: { startsWith: T } } });
    await db.technician.deleteMany({ where: { id: { in: techs.map((t) => t.id) } } });
    await db.notification.deleteMany({ where: { userId: { in: techs.map((t) => t.userId) } } });
    await db.user.deleteMany({ where: { id: { in: techs.map((t) => t.userId) } } });
    if (cat) await db.category.delete({ where: { id: cat.id } });
    const owner = await db.resident.findFirst({ where: { unit: { code: UNIT }, verified: true, isActive: true } });
    if (owner) await db.conversation.updateMany({ where: { residentId: owner.id }, data: { state: "IDLE", activeTicketId: null, context: {} } });
    invalidateCategoryCatalog();
  }
  await db.$disconnect();
});

async function say(phone: string, text: string) {
  const [m] = await getMockWhatsAppProvider().receiveMessage({ from: phone, type: "text", text });
  return handleInboundMessage(m, "mock", { skipDuplicateCheck: true });
}
const lastTo = async (phone: string) => (await db.ticketMessage.findFirst({ where: { OR: [{ toPhone: phone }, { conversation: { phone }, direction: "OUTBOUND" }] }, orderBy: { createdAt: "desc" } }))?.body ?? "";

describe.runIf(process.env.DATABASE_URL)("fake reports & unverified numbers (integration)", () => {
  let catKey = "";
  let tech: { id: string; phone: string; name: string };
  let owner: { id: string; phone: string; name: string };

  it("setup", async () => {
    if (!dbUp) return;
    const cat = (await createRecord("categories", { key: `${T}_CAT`, nameEn: "Doorbell", nameAr: "الجرس", description: "Door bell", keywords: ["الجرس", "جرس", "doorbell"] }, manager)) as { key: string };
    catKey = cat.key;
    tech = (await createRecord("technicians", { name: `${T} Fathy`, phone: `01166${tail}01`, skills: [catKey], maxConcurrent: 10 }, manager)) as typeof tech;
    owner = await db.resident.findFirstOrThrow({ where: { unit: { code: UNIT }, verified: true, isActive: true } });
    await db.conversation.updateMany({ where: { residentId: owner.id }, data: { state: "IDLE", activeTicketId: null, context: {} } });
  });

  it("ticket from an unverified number: technician is warned, unit's verified resident is asked; “1” confirms", async () => {
    if (!dbUp) return;
    const r = await say(stranger, `${UNIT} الجرس بايظ مش بيرن`);
    expect(r.action).toBe("created");
    const t = await getTicketOrThrow(r.ticketId!);
    expect(t.resident?.verified).toBe(false);
    if (t.technicianId !== tech.id) await assignTicket(t.id, { technicianId: tech.id }, manager);
    const offer = await lastTo(tech.phone);
    expect(offer).toContain("غير موثق");
    expect(offer).toContain(owner.phone);
    expect(offer).toContain("3 مع السبب");

    const alert = await lastTo(owner.phone);
    expect(alert).toContain(t.ticketNumber);
    expect(alert).toContain(stranger);
    const ok = await say(owner.phone, "1");
    expect(ok.action).toBe("unit_confirmed");
    expect(await db.ticketEvent.count({ where: { ticketId: t.id, type: "UNIT_CONFIRMED" } })).toBe(1);
    expect(await lastTo(tech.phone)).toContain("أكد");
    expect((await getTicketOrThrow(t.id)).status).not.toBe("CANCELLED");
  });

  it("verified resident answers “2” → ticket cancelled and reported as fake", async () => {
    if (!dbUp) return;
    const r = await say(stranger, "الجرس بيصفر طول الليل");
    expect(r.action).toBe("created");
    const no = await say(owner.phone, "2");
    expect(no.action).toBe("unit_denied");
    const t = await getTicketOrThrow(r.ticketId!);
    expect(t.status).toBe("CANCELLED");
    const rep = await db.fakeReport.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(rep.reporterType).toBe("RESIDENT");
    expect(rep.phone).toBe(stranger);
    expect(rep.status).toBe("PENDING");
  });

  it("technician replies “3” (asks for a reason), then “3 + reason” → cancelled + report", async () => {
    if (!dbUp) return;
    const r = await say(stranger, "الجرس واقع من الحيطة");
    const t0 = await getTicketOrThrow(r.ticketId!);
    if (t0.technicianId !== tech.id) await assignTicket(t0.id, { technicianId: tech.id }, manager);
    const ask = await say(tech.phone, "3");
    expect(ask.replies[0]).toContain("السبب");
    expect((await getTicketOrThrow(t0.id)).status).toBe("ASSIGNED");
    await say(tech.phone, "3 صاحب الشقة قال محدش طلب");
    const t = await getTicketOrThrow(t0.id);
    expect(t.status).toBe("CANCELLED");
    const rep = await db.fakeReport.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(rep.reporterType).toBe("TECHNICIAN");
    expect(rep.reason).toContain("محدش طلب");
    expect(await db.ticketEvent.count({ where: { ticketId: t.id, type: "FAKE_REPORTED" } })).toBe(1);
  });

  it("someone unrelated can't report a ticket", async () => {
    if (!dbUp) return;
    const t = await db.ticket.findFirstOrThrow({ where: { resident: { phone: stranger }, status: { not: "CANCELLED" } } });
    const other: Actor = { type: "TECHNICIAN", name: "x", technicianId: "nobody", role: "TECHNICIAN" };
    await expect(reportFakeTicket(t.id, other, "مش حقيقي خالص")).rejects.toThrow(/Only/);
  });

  it("manager: “not fake” restores the ticket; “confirm & block” blocks the number", async () => {
    if (!dbUp) return;
    const reports = await db.fakeReport.findMany({ where: { phone: stranger }, orderBy: { createdAt: "asc" } });
    expect(reports).toHaveLength(2);
    const restored = await resolveFakeReport(reports[0].id, "dismiss", manager, "اتأكدنا من الساكن");
    expect(restored.restored).toBe(true);
    const t = await getTicketOrThrow(reports[0].ticketId);
    expect(["NEW", "ASSIGNED"]).toContain(t.status);
    expect(await lastTo(stranger)).toContain("إعادة فتح");

    await resolveFakeReport(reports[1].id, "confirm_block", manager);
    expect(await db.blockedPhone.findUnique({ where: { phone: stranger } })).toBeTruthy();
    await expect(resolveFakeReport(reports[1].id, "dismiss", manager)).rejects.toThrow(/already/);
  });

  it("blocked number can't open tickets (notice once a day); unblock lets it back", async () => {
    if (!dbUp) return;
    const before = await db.ticket.count({ where: { resident: { phone: stranger } } });
    const first = await say(stranger, "الجرس بايظ تاني");
    expect(first.action).toBe("blocked");
    expect(first.replies[0]).toContain("موقوف");
    const second = await say(stranger, "الجرس بايظ تالت");
    expect(second.action).toBe("blocked");
    expect(second.replies).toHaveLength(0);
    expect(await db.ticket.count({ where: { resident: { phone: stranger } } })).toBe(before);
    expect((await db.blockedPhone.findUniqueOrThrow({ where: { phone: stranger } })).attempts).toBe(2);

    await unblockPhone(stranger, manager);
    const back = await say(stranger, "الجرس مش شغال خالص");
    expect(back.action).not.toBe("blocked");
  });
});

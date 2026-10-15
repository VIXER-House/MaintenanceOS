/** Reply language follows the resident, status questions always answered, duplicate deliveries processed once. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getMockWhatsAppProvider, type InboundMessage } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";

let dbUp = false;
const tail = Date.now().toString().slice(-4);
const phone = `+201188${tail}55`;
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = !!(await db.unit.findFirst());
  } catch {
    dbUp = false;
  }
  if (!dbUp) return;
  const unit = await db.unit.findFirstOrThrow({ where: { code: "A02-101" } }).catch(() => db.unit.findFirstOrThrow());
  // An English-language resident who writes in Arabic (the reported case)
  await db.resident.create({ data: { phone, name: "Test Lang", nameAr: "تست", unitId: unit.id, verified: true, language: "en" } });
});
afterAll(async () => {
  if (dbUp) {
    const r = await db.resident.findUnique({ where: { phone } });
    if (r) {
      const tks = await db.ticket.findMany({ where: { residentId: r.id }, select: { id: true } });
      const ids = tks.map((t) => t.id);
      const convs = await db.conversation.findMany({ where: { residentId: r.id }, select: { id: true } });
      await db.conversation.updateMany({ where: { residentId: r.id }, data: { activeTicketId: null } });
      await db.ticketMessage.deleteMany({ where: { OR: [{ ticketId: { in: ids } }, { conversationId: { in: convs.map((c) => c.id) } }] } });
      await db.ticket.deleteMany({ where: { id: { in: ids } } });
      await db.conversation.deleteMany({ where: { residentId: r.id } });
      await db.resident.delete({ where: { id: r.id } });
    }
  }
  await db.$disconnect();
});

async function say(text: string) {
  const [m] = await getMockWhatsAppProvider().receiveMessage({ from: phone, type: "text", text });
  return handleInboundMessage(m, "mock");
}

describe.runIf(process.env.DATABASE_URL)("conversation fixes (integration)", () => {
  it("replies in Arabic when the resident writes Arabic, even if their profile says English", async () => {
    if (!dbUp) return;
    const r = await say("عندي مشكلة في السباكة الحوض بيسرب مية في المطبخ");
    expect(r.replies.join("\n")).toSatisfy(hasArabic);
    expect((await db.resident.findUniqueOrThrow({ where: { phone } })).language).toBe("ar");
  });

  it("a status question during “same or different?” is answered and the question is dropped", async () => {
    if (!dbUp) return;
    // The plumbing ticket from the previous step is open (not waiting for a follow-up answer)
    await db.ticket.updateMany({ where: { resident: { phone }, status: "WAITING_FOR_INFO" }, data: { status: "NEW" } });
    await db.conversation.updateMany({ where: { resident: { phone } }, data: { state: "IDLE", activeTicketId: null, context: {} } });
    const ask = await say("عندي مشكلة في السباكة");
    expect(ask.action).toBe("duplicate_check");
    const st = await say("حالة طلباتي");
    expect(st.action).toBe("status");
    expect(st.replies[0]).toMatch(/MAINT-/);
    const conv = await db.conversation.findFirstOrThrow({ where: { resident: { phone } } });
    expect((conv.context as { duplicateCheck?: unknown }).duplicateCheck ?? null).toBeNull();
    expect(conv.state).toBe("IDLE");
  });

  it("“كلمني عربي” / “English please” switch language without touching tickets", async () => {
    if (!dbUp) return;
    const before = await db.ticket.count({ where: { resident: { phone } } });
    const en = await say("English please");
    expect(en.action).toBe("language_changed");
    expect(en.replies[0]).toContain("English");
    const ar = await say("كلمني عربي");
    expect(ar.action).toBe("language_changed");
    expect(ar.replies[0]).toSatisfy(hasArabic);
    expect(await db.ticket.count({ where: { resident: { phone } } })).toBe(before);
  });

  it("the same message delivered twice at once is processed only once", async () => {
    if (!dbUp) return;
    const before = await db.ticket.count({ where: { resident: { phone } } });
    const msg: InboundMessage = { from: phone, providerMessageId: `dup.${tail}.${Date.now()}`, timestamp: new Date(), type: "text", text: "التكييف مش بيبرد خالص في أوضة النوم" };
    const [a, b] = await Promise.all([handleInboundMessage(msg, "mock"), handleInboundMessage({ ...msg }, "mock")]);
    expect([a.action, b.action].filter((x) => x === "duplicate")).toHaveLength(1);
    expect(await db.ticket.count({ where: { resident: { phone } } })).toBe(before + 1);
  });

  it("with an open ticket: “عاوز اسجل شكوى تانية” asks for the problem, and “حريقة” opens an EMERGENCY ticket (not a comment)", async () => {
    if (!dbUp) return;
    await db.conversation.updateMany({ where: { resident: { phone } }, data: { state: "IDLE", activeTicketId: null, context: {} } });
    const open = await db.ticket.count({ where: { resident: { phone }, status: { notIn: ["CANCELLED", "CLOSED", "COMPLETED"] } } });
    expect(open).toBeGreaterThan(0);
    const before = await db.ticket.count({ where: { resident: { phone } } });

    const ask = await say("عاوز اسجل شكوي تانية");
    expect(ask.action).toBe("new_request_prompt");
    expect(ask.replies[0]).toContain("المشكلة الجديدة");

    const fire = await say("في حريقة في العمارة اللي جمبي");
    expect(["created", "follow_up_requested"]).toContain(fire.action);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: fire.ticketId! } });
    expect(t.priority).toBe("EMERGENCY");
    expect(await db.ticket.count({ where: { resident: { phone } } })).toBe(before + 1);
  });

  it("a plain reaction (“شكراً”) on an open ticket is still a comment", async () => {
    if (!dbUp) return;
    await db.conversation.updateMany({ where: { resident: { phone } }, data: { state: "IDLE", activeTicketId: null, context: {} } });
    const r = await say("شكرا");
    expect(r.action).toBe("comment");
  });
});

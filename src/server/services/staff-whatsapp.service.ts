import { db } from "@/lib/db";
import { matchKeyword, normalizeArabic } from "@/lib/arabic";
import { PRIORITY_LABELS, formatMinutesHuman } from "@/server/domain/labels";
import { getMockWhatsAppProvider, getWhatsAppProvider, type InboundMessage } from "@/server/providers/whatsapp";
import { wakeBridge } from "@/server/providers/whatsapp/bridge.provider";
import type { Actor } from "./actor";
import { loadSlaPolicies } from "./sla.service";

/**
 * WhatsApp for field staff (technicians and contractors):
 *  - job offers when a ticket is assigned (reply 1 = accept, 2 + reason = can't come)
 *  - "job moved to someone else", reminders when they don't answer
 *  - replies from their phone are routed here instead of the resident intake
 */

export interface StaffContact {
  kind: "technician" | "contractor";
  id: string;
  name: string;
  phone: string;
  actor: Actor;
}

/** Technician or contractor that owns this phone number (active ones only). */
export async function findStaffByPhone(phone: string): Promise<StaffContact | null> {
  const tech = await db.technician.findFirst({ where: { phone, isActive: true }, include: { user: true } });
  if (tech) {
    return {
      kind: "technician",
      id: tech.id,
      name: tech.nameAr ?? tech.name,
      phone: tech.phone,
      actor: { type: "TECHNICIAN", name: tech.name, userId: tech.userId, role: "TECHNICIAN", technicianId: tech.id },
    };
  }
  const c = await db.contractor.findFirst({ where: { phone, isActive: true }, include: { users: { take: 1 } } });
  if (c) {
    return {
      kind: "contractor",
      id: c.id,
      name: c.nameAr ?? c.name,
      phone: c.phone,
      actor: { type: "CONTRACTOR", name: c.name, userId: c.users[0]?.id ?? null, role: "CONTRACTOR", contractorId: c.id },
    };
  }
  return null;
}

/** Send a WhatsApp text to a staff phone and keep a copy on the ticket. Never throws. */
export async function sendStaffWhatsApp(phone: string | null | undefined, body: string, ticketId?: string | null, toName?: string | null, opts: { simulate?: boolean } = {}) {
  if (!phone) return null;
  // Demo / simulator tickets never message real phones
  const provider = opts.simulate ? getMockWhatsAppProvider() : getWhatsAppProvider();
  let result: Awaited<ReturnType<typeof provider.sendMessage>>;
  try {
    result = await provider.sendMessage(phone, body);
  } catch (e) {
    result = { provider: provider.name, providerMessageId: null, status: "FAILED", error: (e as Error).message };
  }
  const msg = await db.ticketMessage
    .create({
      data: {
        ticketId: ticketId ?? null,
        toPhone: phone,
        direction: "OUTBOUND",
        channel: "WHATSAPP",
        senderType: "SYSTEM",
        senderName: `MaintenanceOS → ${toName ?? phone}`,
        body,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        status: result.status === "FAILED" ? "FAILED" : result.status === "QUEUED" ? "QUEUED" : "SENT",
        error: result.error ?? null,
      },
    })
    .catch((e) => {
      console.error("[staff-whatsapp] could not store message", e);
      return null;
    });
  if (msg?.status === "QUEUED" && msg.provider === "bridge") await wakeBridge();
  return msg;
}

// ───────────────────────── message texts (Arabic — field staff) ─────────────────────────

type JobTicket = Awaited<ReturnType<typeof loadJob>>;

async function loadJob(ticketId: string) {
  return db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      unit: { include: { building: true } },
      resident: { include: { conversations: { select: { context: true }, take: 1 } } },
      category: true,
      asset: true,
      aiAnalyses: { orderBy: { createdAt: "desc" }, take: 1, select: { entities: true, location: true } },
    },
  });
}

/** Arabic issue text from the AI analysis when there is one (titles are English). */
const PLACES_AR: Record<string, string> = {
  kitchen: "المطبخ", bathroom: "الحمام", bedroom: "أوضة النوم", "living room": "الصالة", balcony: "البلكونة", entrance: "المدخل",
  roof: "السطح", garage: "الجراج", garden: "الجنينة", lobby: "اللوبي", corridor: "الطرقة", stairs: "السلم",
};
function issueAr(t: JobTicket) {
  const e = t.aiAnalyses[0]?.entities as { issueAr?: string } | null | undefined;
  const place = t.location ? PLACES_AR[t.location.toLowerCase()] ?? t.location : null;
  return e?.issueAr ? `${e.issueAr}${place ? ` — ${place}` : ""}` : t.title;
}

/** Demo runs and simulator conversations stay inside the app (no real WhatsApp to staff). */
function isSimulated(t: JobTicket) {
  if (t.isDemo) return true;
  const ctx = t.resident?.conversations[0]?.context as { provider?: string } | null | undefined;
  return t.source === "WHATSAPP" && ctx?.provider === "mock";
}

async function jobOfferText(t: JobTicket, assigneeName: string) {
  const policies = await loadSlaPolicies();
  const lines = [
    `🔧 أهلاً ${assigneeName.split(" ")[0]}، عندك طلب صيانة جديد`,
    `رقم الطلب: ${t.ticketNumber} — الأولوية: ${PRIORITY_LABELS[t.priority].ar}${t.priority === "EMERGENCY" ? " 🚨" : ""}`,
    `المشكلة: ${issueAr(t)}`,
    t.category ? `التصنيف: ${t.category.nameAr}` : null,
    t.unit ? `المكان: الوحدة ${t.unit.code} — مبنى ${t.unit.building.code}، الدور ${t.unit.floor}` : null,
    t.resident ? `الساكن: ${t.resident.nameAr ?? t.resident.name} — ${t.resident.phone}` : null,
    t.asset ? `الجهاز: ${t.asset.nameAr ?? t.asset.name} (${t.asset.assetCode})` : null,
    t.slaResponseDueAt ? `لازم ترد خلال: ${formatMinutesHuman(policies[t.priority].responseMinutes, "ar")}` : null,
    "",
    `رد بـ 1 للقبول ✅`,
    `أو 2 مع السبب لو مش هتقدر (مثال: 2 عندي ظرف عائلي)`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** Tell the new assignee (and the previous one, if the job moved). */
export async function notifyAssignment(ticketId: string, previous?: { technicianId?: string | null; contractorId?: string | null }) {
  try {
    const t = await loadJob(ticketId);
    const [tech, contractor] = await Promise.all([
      t.technicianId ? db.technician.findUnique({ where: { id: t.technicianId } }) : null,
      t.contractorId ? db.contractor.findUnique({ where: { id: t.contractorId } }) : null,
    ]);
    const assignee = tech ?? contractor;
    const simulate = isSimulated(t);
    if (assignee) await sendStaffWhatsApp(assignee.phone, await jobOfferText(t, assignee.nameAr ?? assignee.name), t.id, assignee.name, { simulate });

    // The job was taken away from someone else
    if (previous?.technicianId && previous.technicianId !== t.technicianId) {
      const old = await db.technician.findUnique({ where: { id: previous.technicianId } });
      if (old) await sendStaffWhatsApp(old.phone, `ℹ️ الطلب ${t.ticketNumber} (${issueAr(t)}) اتحول لزميل تاني — مش محتاج تروح.`, t.id, old.name, { simulate });
    }
    if (previous?.contractorId && previous.contractorId !== t.contractorId) {
      const old = await db.contractor.findUnique({ where: { id: previous.contractorId } });
      if (old) await sendStaffWhatsApp(old.phone, `ℹ️ الطلب ${t.ticketNumber} (${issueAr(t)}) اتحول لجهة تانية — مش محتاج تروحوا.`, t.id, old.name, { simulate });
    }
  } catch (e) {
    console.error("[staff-whatsapp] notifyAssignment failed", e);
  }
}

export async function sendAssignmentReminder(ticketId: string) {
  const t = await loadJob(ticketId);
  const assignee = t.technicianId
    ? await db.technician.findUnique({ where: { id: t.technicianId } })
    : t.contractorId
      ? await db.contractor.findUnique({ where: { id: t.contractorId } })
      : null;
  if (!assignee) return;
  await sendStaffWhatsApp(
    assignee.phone,
    `⏰ تذكير: الطلب ${t.ticketNumber} (${issueAr(t)}${t.unit ? ` — ${t.unit.code}` : ""}) لسه مستني ردك.\nرد بـ 1 للقبول أو 2 مع السبب لو مش هتقدر.`,
    t.id,
    assignee.name,
    { simulate: isSimulated(t) },
  );
}

// ───────────────────────── replies from staff ─────────────────────────

const ACCEPT = ["1", "١", "قبول", "اقبل", "موافق", "تمام", "ماشي", "حاضر", "اوك", "ok", "okay", "accept", "yes", "جاي", "انا جاي", "في الطريق", "رايح"];
const DECLINE = ["2", "٢", "اعتذار", "اعتذر", "معتذر", "مش هقدر", "مقدرش", "مش فاضي", "مش قادر", "رفض", "لا", "decline", "no", "cant", "can't", "cannot"];
const LIST = ["مهامي", "طلباتي", "الطلبات", "jobs", "my jobs", "list", "3", "٣"];

export type StaffIntent = { kind: "accept" | "decline"; ticketNumber: number | null; reason: string } | { kind: "list" } | { kind: "unknown" };

/** "1", "1 MAINT-000123", "2 عندي ظرف عائلي", "مش هقدر النهارده عشان تعبان", "مهامي" */
export function parseStaffReply(text: string): StaffIntent {
  const raw = String(text ?? "").trim();
  const ticketMatch = raw.match(/maint-?0*(\d+)/i);
  const ticketNumber = ticketMatch ? Number(ticketMatch[1]) : null;
  const rest = raw.replace(/maint-?\d+/gi, " ").trim();
  const n = normalizeArabic(rest);
  const first = n.split(" ")[0] ?? "";
  const startsWith = (words: string[]) => words.some((w) => first === normalizeArabic(w) || (w.includes(" ") && n.startsWith(normalizeArabic(w))));
  if (LIST.some((w) => n === normalizeArabic(w))) return { kind: "list" };
  if (startsWith(DECLINE) || DECLINE.some((w) => w.length > 3 && matchKeyword(n, w))) {
    const reason = rest.replace(/^\s*(2|٢)\s*[-–:.,]?\s*/, "").trim();
    return { kind: "decline", ticketNumber, reason: reason === rest && /^(2|٢)$/.test(rest) ? "" : reason };
  }
  if (startsWith(ACCEPT)) return { kind: "accept", ticketNumber, reason: "" };
  return { kind: "unknown" };
}

export async function handleStaffMessage(staff: StaffContact, msg: InboundMessage, providerName = "whatsapp"): Promise<{ action: string; ticketNumber?: string; replies: string[] }> {
  // Lazy import to avoid a cycle (ticket.service → staff-whatsapp.service)
  const { acknowledgeTicket, declineAssignment } = await import("./ticket.service");
  // Keep their message (also makes Meta/bridge retries idempotent)
  const inbound = await db.ticketMessage.create({
    data: {
      direction: "INBOUND",
      channel: "WHATSAPP",
      senderType: staff.kind === "technician" ? "TECHNICIAN" : "CONTRACTOR",
      senderName: staff.name,
      body: msg.text ?? "",
      toPhone: null,
      provider: providerName,
      providerMessageId: msg.providerMessageId,
      status: "RECEIVED",
      createdAt: msg.timestamp,
    },
  });
  const reply = async (body: string, ticketId?: string | null) => {
    if (ticketId) await db.ticketMessage.update({ where: { id: inbound.id }, data: { ticketId } }).catch(() => null);
    await sendStaffWhatsApp(staff.phone, body, ticketId, staff.name, { simulate: providerName === "mock" });
    return body;
  };
  const mine = { ...(staff.kind === "technician" ? { technicianId: staff.id } : { contractorId: staff.id }) };
  const intent = parseStaffReply(msg.text ?? "");
  const active = await db.ticket.findMany({
    where: { ...mine, status: { in: ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_QUOTATION", "WAITING_APPROVAL", "APPROVED", "REJECTED"] } },
    orderBy: { assignedAt: "desc" },
    select: { id: true, number: true, ticketNumber: true, title: true, status: true },
  });
  const pending = active.filter((t) => t.status === "ASSIGNED");

  if (intent.kind === "list" || intent.kind === "unknown") {
    const list = active.length
      ? active.map((t) => `• ${t.ticketNumber} — ${t.title}${t.status === "ASSIGNED" ? " (مستني ردك)" : ""}`).join("\n")
      : "مفيش طلبات مفتوحة عليك دلوقتي 👍";
    const help = "للقبول: 1 (أو 1 MAINT-000123)\nللاعتذار: 2 والسبب (مثال: 2 عندي ظرف عائلي)\nلعرض طلباتك: مهامي";
    return { action: intent.kind === "list" ? "staff_list" : "staff_help", replies: [await reply(`${list}\n\n${help}`)] };
  }

  // Which ticket? The one named, else the most recent job waiting for an answer
  const target = intent.ticketNumber ? active.find((t) => t.number === intent.ticketNumber) : intent.kind === "accept" ? pending[0] : pending[0] ?? active[0];
  if (!target) {
    const body = intent.ticketNumber ? `مش لاقي الطلب MAINT-${String(intent.ticketNumber).padStart(6, "0")} ضمن طلباتك.` : "مفيش طلب مستني ردك دلوقتي. ابعت “مهامي” عشان تشوف طلباتك.";
    return { action: "staff_no_ticket", replies: [await reply(body)] };
  }

  if (intent.kind === "accept") {
    if (target.status !== "ASSIGNED") return { action: "staff_already", ticketNumber: target.ticketNumber, replies: [await reply(`الطلب ${target.ticketNumber} مقبول بالفعل ✅`, target.id)] };
    await acknowledgeTicket(target.id, staff.actor);
    return { action: "staff_accepted", ticketNumber: target.ticketNumber, replies: [await reply(`تمام ✅ تم تسجيل قبولك للطلب ${target.ticketNumber}. بالتوفيق!`, target.id)] };
  }

  // decline — a reason is required so the manager knows why
  if (intent.reason.replace(/[^\p{L}\p{N}]/gu, "").length < 3) {
    return { action: "staff_reason_needed", ticketNumber: target.ticketNumber, replies: [await reply(`محتاج سبب الاعتذار عن الطلب ${target.ticketNumber} عشان المسؤول يعرف.\nابعت 2 ومعاها السبب، مثال: 2 عندي ظرف عائلي`, target.id)] };
  }
  const r = await declineAssignment(target.id, staff.actor, intent.reason);
  const next = r.reassignedTo ? `واتحول لـ ${r.reassignedTo}.` : "والمسؤول هيحوله لحد تاني.";
  return { action: "staff_declined", ticketNumber: target.ticketNumber, replies: [await reply(`تمام، اتسجل اعتذارك عن الطلب ${target.ticketNumber} ${next}`, target.id)] };
}

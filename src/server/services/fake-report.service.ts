import { Prisma, type FakeReportStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { isAffirmativeAnswer, isNegativeAnswer } from "@/server/domain/answers";
import { isManager } from "@/server/domain/constants";
import { canTransition } from "@/server/engines/lifecycle/ticket-lifecycle";
import { normalizeArabic } from "@/lib/arabic";
import { SYSTEM_ACTOR, type Actor } from "./actor";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { recordEvent } from "./event.service";
import { ctx, getOrCreateConversation, normalizePhone, sendToResident, updateConversation, type ConversationContext } from "./messaging.service";
import { notifyRoles } from "./notification.service";
import { isTicketSimulated, sendStaffWhatsApp, ticketIssueAr, verifiedUnitContacts } from "./staff-whatsapp.service";

/**
 * Fake tickets & blocked numbers.
 *
 *  - A ticket opened from an UNVERIFIED number → the unit's verified residents get a WhatsApp
 *    ("1" = we know about it, "2" = not us) and the technician's job offer carries a warning.
 *  - The assigned technician (WhatsApp "3 + reason" or the dashboard), a manager, or the unit's
 *    verified resident can report the ticket as fake → it is cancelled and lands in the manager's
 *    "Fake reports" list.
 *  - The manager confirms (optionally blocking the number) or dismisses it (the ticket is restored).
 *  - Blocked numbers can't open tickets any more.
 */

const UNIT_ALERT_TTL_MS = 48 * 3600_000;
const BLOCK_NOTICE_EVERY_MS = 24 * 3600_000;

function cleanReason(reason: string) {
  const why = String(reason ?? "").trim().slice(0, 500);
  if (why.replace(/[^\p{L}\p{N}]/gu, "").length < 3) throw new AppError("Please give a reason", 400, "VALIDATION_ERROR");
  return why;
}

async function auditLog(actor: Actor, entity: string, entityId: string | null, action: string, summary: string) {
  await db.auditLog
    .create({ data: { actorId: actor.userId ?? null, actorName: actor.name, entity, entityId, action, summary } })
    .catch((e) => console.error("[audit] failed", e));
}

// ───────────────────────── reporting ─────────────────────────

/**
 * Report a ticket as fake. Allowed for managers, the assigned technician/contractor, and a
 * verified resident of the ticket's unit (who is not the person that opened it).
 * Open tickets are cancelled right away; a manager reviews the report later.
 */
export async function reportFakeTicket(ticketId: string, actor: Actor, reason: string) {
  const why = cleanReason(reason);
  const t = await db.ticket.findUnique({ where: { id: ticketId }, include: { resident: true, technician: true, contractor: true } });
  if (!t) throw new NotFoundError("Ticket");

  const manager = !!actor.role && isManager(actor.role);
  const assignee = (!!actor.technicianId && actor.technicianId === t.technicianId) || (!!actor.contractorId && actor.contractorId === t.contractorId);
  let unitResident = false;
  if (actor.type === "RESIDENT" && actor.residentId && actor.residentId !== t.residentId && t.unitId) {
    const r = await db.resident.findUnique({ where: { id: actor.residentId } });
    unitResident = !!r && r.verified && r.isActive && r.unitId === t.unitId;
  }
  if (actor.type !== "SYSTEM" && !manager && !assignee && !unitResident) {
    throw new ForbiddenError("Only the assigned technician, a manager or the unit's verified resident can report this ticket");
  }
  if (!t.resident) throw new ConflictError("This ticket has no resident phone to report");

  const existing = await db.fakeReport.findFirst({ where: { ticketId, status: "PENDING" } });
  if (existing) return { report: existing, cancelled: existing.ticketCancelled, alreadyReported: true };

  const cancel = canTransition(t.status, "CANCELLED");
  const report = await db.$transaction(async (tx) => {
    if (cancel) {
      await tx.ticket.update({ where: { id: t.id, status: t.status }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await recordEvent(t.id, "CANCELLED", actor, `Cancelled — reported as fake by ${actor.name}`, { from: t.status, to: "CANCELLED" }, tx);
    }
    await recordEvent(t.id, "FAKE_REPORTED", actor, `${actor.name} reported this ticket as fake: “${why}”`, { reason: why, phone: t.resident!.phone }, tx);
    return tx.fakeReport.create({
      data: {
        ticketId: t.id,
        phone: t.resident!.phone,
        residentId: t.residentId,
        reporterType: actor.type,
        reporterName: actor.name,
        reason: why,
        ticketCancelled: cancel,
        previousStatus: t.status,
      },
    });
  });

  const previousReports = await db.fakeReport.count({ where: { phone: report.phone, id: { not: report.id } } });
  await notifyRoles(["MAINTENANCE_MANAGER", "COMPOUND_MANAGER"], {
    title: `Fake report: ${t.ticketNumber}${previousReports ? ` (${previousReports + 1} reports for this number)` : ""}`,
    body: `${actor.name}: ${why} — number ${report.phone}${t.resident.verified ? "" : " (unverified)"}`,
    link: `/fake-reports`,
    ticketId: t.id,
  });

  if (cancel) {
    const simulate = await isTicketSimulated(t.id);
    const issue = await ticketIssueAr(t.id);
    // Free the assignee (unless they're the one who reported it)
    const assigneeContact = t.technician ?? t.contractor;
    if (assigneeContact && !assignee) {
      await sendStaffWhatsApp(assigneeContact.phone, `ℹ️ الطلب ${t.ticketNumber} (${issue}) اتلغى — اتبلغ عنه إنه وهمي. مش محتاج تروح.`, t.id, assigneeContact.name, { simulate });
    }
    // Tell the person who opened it, and stop their conversation from pointing at it
    const lang = t.resident.language === "en" ? "en" : "ar";
    await sendToResident(
      t.resident.id,
      lang === "ar"
        ? `تم إلغاء طلب الصيانة ${t.ticketNumber} بعد المراجعة. لو المشكلة حقيقية تواصل مع إدارة الكمبوند.`
        : `Maintenance request ${t.ticketNumber} was cancelled after review. If the problem is real, please contact compound management.`,
      { ticketId: t.id },
    );
    await db.conversation.updateMany({ where: { residentId: t.resident.id, activeTicketId: t.id }, data: { state: "IDLE", activeTicketId: null } });
  }
  return { report, cancelled: cancel, alreadyReported: false };
}

// ───────────────────────── manager review ─────────────────────────

export type FakeDecision = "confirm" | "confirm_block" | "dismiss";

export async function resolveFakeReport(reportId: string, decision: FakeDecision, actor: Actor, note?: string | null) {
  if (!actor.role || !isManager(actor.role)) throw new ForbiddenError("This action requires a manager");
  const report = await db.fakeReport.findUnique({ where: { id: reportId }, include: { ticket: { include: { resident: true } } } });
  if (!report) throw new NotFoundError("Fake report");
  if (report.status !== "PENDING") throw new ConflictError("This report was already reviewed");
  const status: FakeReportStatus = decision === "dismiss" ? "DISMISSED" : "CONFIRMED";
  const claimed = await db.fakeReport.updateMany({
    where: { id: report.id, status: "PENDING" },
    data: { status, resolvedAt: new Date(), resolvedByName: actor.name, resolutionNote: note?.trim() || null },
  });
  if (!claimed.count) throw new ConflictError("This report was already reviewed");

  const t = report.ticket;
  if (decision !== "dismiss") {
    await recordEvent(t.id, "FAKE_CONFIRMED", actor, `${actor.name} confirmed the ticket is fake${note ? `: ${note}` : ""}`);
    if (decision === "confirm_block") await blockPhone(report.phone, `Fake ticket ${t.ticketNumber}: ${report.reason}`, actor);
    await auditLog(actor, "fakeReport", report.id, decision, `Confirmed ${t.ticketNumber} as fake${decision === "confirm_block" ? ` and blocked ${report.phone}` : ""}`);
    return { status, restored: false };
  }

  // Not fake → put the ticket back to work
  await recordEvent(t.id, "FAKE_DISMISSED", actor, `${actor.name}: not fake${note ? ` — ${note}` : ""}`);
  let restored = false;
  if (report.ticketCancelled && t.status === "CANCELLED") {
    // A deliberate exception to the state machine (CANCELLED is terminal): only an undone fake report may revive a ticket
    await db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: t.id, status: "CANCELLED" },
        data: { status: "NEW", cancelledAt: null, technicianId: null, contractorId: null, assignedAt: null, acknowledgedAt: null, assignReminderAt: null },
      });
      await recordEvent(t.id, "REOPENED", actor, "Restored after the fake report was dismissed", { from: "CANCELLED", to: "NEW" }, tx);
    });
    restored = true;
    const { autoAssign } = await import("./ticket.service");
    await autoAssign(t.id, { why: "Restored after fake report", notifyResident: false });
    if (t.resident) {
      const lang = t.resident.language === "en" ? "en" : "ar";
      await sendToResident(
        t.resident.id,
        lang === "ar" ? `تم إعادة فتح طلب الصيانة ${t.ticketNumber} وجاري التعامل معاه. نعتذر عن التأخير 🙏` : `Maintenance request ${t.ticketNumber} was reopened and is being handled. Sorry for the delay 🙏`,
        { ticketId: t.id },
      );
    }
  }
  await auditLog(actor, "fakeReport", report.id, "dismiss", `Dismissed fake report on ${t.ticketNumber}${restored ? " — ticket restored" : ""}`);
  return { status, restored };
}

// ───────────────────────── blocked numbers ─────────────────────────

export async function isPhoneBlocked(phone: string) {
  return !!(await db.blockedPhone.findUnique({ where: { phone: normalizePhone(phone) }, select: { id: true } }));
}

export async function blockPhone(phone: string, reason: string, actor: Actor) {
  if (actor.type !== "SYSTEM" && (!actor.role || !isManager(actor.role))) throw new ForbiddenError("This action requires a manager");
  const p = normalizePhone(phone);
  if (p.length < 9) throw new AppError("Enter a valid phone number", 400, "VALIDATION_ERROR");
  const staff = (await db.technician.findFirst({ where: { phone: p }, select: { id: true } })) ?? (await db.contractor.findFirst({ where: { phone: p }, select: { id: true } }));
  if (staff) throw new AppError("This number belongs to a technician/contractor — archive them instead", 400, "VALIDATION_ERROR");
  const why = reason.trim().slice(0, 500) || "Blocked by a manager";
  const row = await db.blockedPhone.upsert({ where: { phone: p }, update: { reason: why, blockedByName: actor.name }, create: { phone: p, reason: why, blockedByName: actor.name } });
  // Anything they're in the middle of is dropped
  await db.conversation.updateMany({ where: { phone: p }, data: { state: "IDLE", activeTicketId: null } });
  await auditLog(actor, "blockedPhone", row.id, "block", `Blocked ${p}: ${why}`);
  return row;
}

export async function unblockPhone(phone: string, actor: Actor) {
  if (!actor.role || !isManager(actor.role)) throw new ForbiddenError("This action requires a manager");
  const p = normalizePhone(phone);
  const row = await db.blockedPhone.findUnique({ where: { phone: p } });
  if (!row) throw new NotFoundError("Blocked number");
  await db.blockedPhone.delete({ where: { id: row.id } });
  await auditLog(actor, "blockedPhone", row.id, "unblock", `Unblocked ${p}`);
  return { ok: true };
}

/** A blocked number wrote again: count it, and tell them (at most once a day). Returns the notice text, if any. */
export async function registerBlockedAttempt(phone: string): Promise<string | null> {
  const p = normalizePhone(phone);
  const row = await db.blockedPhone.findUnique({ where: { phone: p } });
  if (!row) return null;
  const now = new Date();
  const notify = !row.lastNoticeAt || now.getTime() - row.lastNoticeAt.getTime() > BLOCK_NOTICE_EVERY_MS;
  await db.blockedPhone.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastAttemptAt: now, ...(notify ? { lastNoticeAt: now } : {}) } });
  return notify ? "عذراً، الرقم ده موقوف عن تسجيل طلبات الصيانة. لو في خطأ تواصل مع إدارة الكمبوند.\nSorry, this number can no longer log maintenance requests. Please contact compound management." : null;
}

// ───────────────────────── unverified number → ask the unit ─────────────────────────

/**
 * A ticket was opened from an unverified number: message the unit's verified residents so
 * they can confirm ("1") or say it's not them ("2" → reported as fake, cancelled).
 */
export async function alertUnitOfUnverifiedTicket(ticketId: string) {
  try {
    const t = await db.ticket.findUnique({ where: { id: ticketId }, include: { resident: true, unit: true } });
    if (!t?.resident || t.resident.verified || !t.unitId) return { notified: 0 };
    const contacts = await verifiedUnitContacts(t.unitId, t.residentId);
    if (!contacts.length) {
      await recordEvent(t.id, "NOTE_ADDED", SYSTEM_ACTOR, `Opened from an unverified number (${t.resident.phone}) — no verified resident on ${t.unit?.code ?? "this unit"} to confirm it`);
      return { notified: 0 };
    }
    const simulate = await isTicketSimulated(t.id);
    const issue = await ticketIssueAr(t.id);
    const who = t.resident.name.startsWith("WhatsApp ") ? t.resident.phone : `${t.resident.nameAr ?? t.resident.name} — ${t.resident.phone}`;
    for (const c of contacts) {
      const ar = c.language !== "en";
      const body = ar
        ? [
            `🔔 تنبيه من إدارة الصيانة`,
            `اتسجل طلب صيانة ${t.ticketNumber} على وحدتك ${t.unit?.code ?? ""} من رقم مش مسجل عندنا: ${who}`,
            `المشكلة: ${issue}`,
            ``,
            `لو الطلب ده منكم أو تعرفوا صاحبه رد بـ 1 ✅`,
            `لو محدش منكم طلبه رد بـ 2 ❌ وهنلغيه`,
          ].join("\n")
        : [
            `🔔 Maintenance notice`,
            `Request ${t.ticketNumber} was opened for your unit ${t.unit?.code ?? ""} from a number we don't have on file: ${who}`,
            `Issue: ${t.title}`,
            ``,
            `Reply 1 ✅ if you know about it`,
            `Reply 2 ❌ if nobody in your unit asked for it and we'll cancel it`,
          ].join("\n");
      await sendToResident(c.id, body, { ticketId: t.id, via: simulate ? "mock" : "real" });
      const conv = await getOrCreateConversation(c.id, c.phone);
      await updateConversation(conv.id, { context: { ...ctx(conv), unitAlert: { ticketId: t.id, ticketNumber: t.ticketNumber, at: new Date().toISOString() } } });
    }
    await recordEvent(t.id, "NOTE_ADDED", SYSTEM_ACTOR, `Opened from an unverified number — asked ${contacts.map((c) => c.name).join(", ")} (verified resident${contacts.length > 1 ? "s" : ""} of ${t.unit?.code}) to confirm`);
    return { notified: contacts.length };
  } catch (e) {
    console.error("[fake-report] unit alert failed", e);
    return { notified: 0 };
  }
}

const CONFIRM_WORDS = ["1", "١", "ايوه", "ايوة", "اه", "نعم", "صح", "تمام", "اعرفه", "عارفه", "عارفينه", "مننا", "مني", "انا", "ابني", "بنتي", "مراتي", "جوزي", "yes", "ok", "mine", "me"];
const DENY_WORDS = ["2", "٢", "مش انا", "مش احنا", "مش مني", "مش مننا", "معرفوش", "منعرفوش", "محدش طلب", "وهمي", "مش حقيقي", "no", "not me", "not us", "fake"];

/** "1" / "2" (or yes / not us) to a unit alert. Null = not an answer to it. */
export function parseUnitAlertAnswer(text: string): "confirm" | "deny" | null {
  const n = normalizeArabic(String(text ?? "").trim());
  if (!n || n.length > 40) return null;
  if (DENY_WORDS.some((w) => n === normalizeArabic(w) || n.startsWith(`${normalizeArabic(w)} `)) || (isNegativeAnswer(n) && n.split(" ").length <= 3)) return "deny";
  if (CONFIRM_WORDS.some((w) => n === normalizeArabic(w) || n.startsWith(`${normalizeArabic(w)} `)) || (n.split(" ").length <= 2 && isAffirmativeAnswer(n) && !/\d/.test(n))) return "confirm";
  return null;
}

/**
 * Called by the intake for a verified resident with a pending unit alert.
 * Returns the reply text when the message answered the alert, otherwise null (normal intake continues).
 */
export async function handleUnitAlertReply(
  resident: { id: string; name: string; nameAr: string | null; language: string; userId: string | null },
  conversation: { id: string; context: unknown },
  text: string,
): Promise<{ reply: string; ticketId: string; action: "unit_confirmed" | "unit_denied" } | null> {
  const context = (conversation.context ?? {}) as ConversationContext;
  const alert = context.unitAlert;
  if (!alert) return null;
  const clear = () => updateConversation(conversation.id, { context: { ...context, unitAlert: null } });
  if (Date.now() - new Date(alert.at).getTime() > UNIT_ALERT_TTL_MS) {
    await clear();
    return null;
  }
  const answer = parseUnitAlertAnswer(text);
  if (!answer) return null;
  await clear();
  const ar = resident.language !== "en";
  const actor: Actor = { type: "RESIDENT", name: resident.nameAr ?? resident.name, residentId: resident.id, userId: resident.userId };
  const t = await db.ticket.findUnique({ where: { id: alert.ticketId }, include: { technician: true, contractor: true } });
  if (!t) return null;
  if (t.status === "CANCELLED") {
    return { ticketId: t.id, action: answer === "confirm" ? "unit_confirmed" : "unit_denied", reply: ar ? `الطلب ${t.ticketNumber} اتلغى بالفعل. شكراً 🙏` : `${t.ticketNumber} was already cancelled. Thank you 🙏` };
  }

  if (answer === "confirm") {
    await recordEvent(t.id, "UNIT_CONFIRMED", actor, `${actor.name} (verified resident) confirmed this request`);
    const assignee = t.technician ?? t.contractor;
    if (assignee && !["CANCELLED", "CLOSED"].includes(t.status)) {
      await sendStaffWhatsApp(assignee.phone, `✅ الطلب ${t.ticketNumber}: ${actor.name} (ساكن موثق للوحدة) أكد إن الطلب حقيقي.`, t.id, assignee.name, { simulate: await isTicketSimulated(t.id) });
    }
    return { ticketId: t.id, action: "unit_confirmed", reply: ar ? `شكراً للتأكيد 🙏 هنكمل على الطلب ${t.ticketNumber}.` : `Thanks for confirming 🙏 We'll go ahead with ${t.ticketNumber}.` };
  }

  await reportFakeTicket(t.id, actor, `Verified resident ${actor.name} says nobody in the unit requested it`).catch((e) => {
    if (!(e instanceof ConflictError)) throw e;
  });
  return {
    ticketId: t.id,
    action: "unit_denied",
    reply: ar ? `تمام، اتلغى الطلب ${t.ticketNumber} والإدارة هتراجع الرقم ده. شكراً إنك بلغتنا 🙏` : `Done — ${t.ticketNumber} was cancelled and management will review that number. Thanks for letting us know 🙏`,
  };
}

// ───────────────────────── manager page ─────────────────────────

export async function listFakeReports(filter: { status?: FakeReportStatus | "ALL" } = {}) {
  const where: Prisma.FakeReportWhereInput = filter.status && filter.status !== "ALL" ? { status: filter.status } : {};
  const [reports, blocked, counts] = await Promise.all([
    db.fakeReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { ticket: { select: { id: true, ticketNumber: true, title: true, status: true, unit: { select: { code: true } }, resident: { select: { id: true, name: true, nameAr: true, verified: true } } } } },
    }),
    db.blockedPhone.findMany({ orderBy: { createdAt: "desc" } }),
    db.fakeReport.groupBy({ by: ["phone", "status"], _count: { _all: true } }),
  ]);
  const blockedSet = new Set(blocked.map((b) => b.phone));
  const perPhone = new Map<string, { total: number; confirmed: number }>();
  for (const c of counts) {
    const cur = perPhone.get(c.phone) ?? { total: 0, confirmed: 0 };
    cur.total += c._count._all;
    if (c.status === "CONFIRMED") cur.confirmed += c._count._all;
    perPhone.set(c.phone, cur);
  }
  const pending = counts.filter((c) => c.status === "PENDING").reduce((s, c) => s + c._count._all, 0);
  return {
    pending,
    reports: reports.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      phone: r.phone,
      status: r.status,
      reason: r.reason,
      reporterName: r.reporterName,
      reporterType: r.reporterType,
      ticketCancelled: r.ticketCancelled,
      resolvedByName: r.resolvedByName,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      ticket: { id: r.ticket.id, number: r.ticket.ticketNumber, title: r.ticket.title, status: r.ticket.status, unit: r.ticket.unit?.code ?? null },
      residentName: r.ticket.resident ? r.ticket.resident.nameAr ?? r.ticket.resident.name : null,
      residentVerified: r.ticket.resident?.verified ?? false,
      blocked: blockedSet.has(r.phone),
      reportsForPhone: perPhone.get(r.phone)?.total ?? 1,
      confirmedForPhone: perPhone.get(r.phone)?.confirmed ?? 0,
    })),
    blocked: blocked.map((b) => ({
      id: b.id,
      phone: b.phone,
      reason: b.reason,
      blockedByName: b.blockedByName,
      attempts: b.attempts,
      lastAttemptAt: b.lastAttemptAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

export async function pendingFakeReportCount() {
  return db.fakeReport.count({ where: { status: "PENDING" } });
}

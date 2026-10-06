import { db } from "@/lib/db";
import type { Priority } from "@/server/domain/constants";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { DEFAULT_SLA_POLICIES, computeSlaDeadlines, type SlaPolicyConfig } from "@/server/engines/sla/sla-engine";
import { SYSTEM_ACTOR } from "./actor";
import { recordEvent } from "./event.service";
import { notifyRoles } from "./notification.service";

export async function loadSlaPolicies(): Promise<Record<Priority, SlaPolicyConfig>> {
  const rows = await db.slaPolicy.findMany();
  const out = { ...DEFAULT_SLA_POLICIES };
  for (const r of rows) out[r.priority] = { responseMinutes: r.responseMinutes, resolutionMinutes: r.resolutionMinutes };
  return out;
}

export async function computeTicketSla(priority: Priority, createdAt: Date, categoryResolutionMinutes?: number | null) {
  const policies = await loadSlaPolicies();
  return computeSlaDeadlines({ priority, createdAt, policies, categoryResolutionMinutes });
}

let lastSweep = 0;

/**
 * Flags newly-breached SLAs, writes SLA_BREACHED events and alerts managers.
 * Called lazily (dashboard/ticket list loads, throttled) so no cron is needed for
 * the MVP; in production run it from a scheduler every minute.
 */
export async function sweepSlaBreaches(force = false): Promise<number> {
  const now = new Date();
  if (!force && now.getTime() - lastSweep < 30_000) return 0;
  lastSweep = now.getTime();

  const responseBreaches = await db.ticket.findMany({
    where: { status: { in: OPEN_STATUSES }, slaResponseBreached: false, acknowledgedAt: null, slaResponseDueAt: { lt: now } },
    select: { id: true, ticketNumber: true, priority: true },
  });
  const resolutionBreaches = await db.ticket.findMany({
    where: { status: { in: OPEN_STATUSES }, slaResolutionBreached: false, completedAt: null, slaResolutionDueAt: { lt: now } },
    select: { id: true, ticketNumber: true, priority: true },
  });

  for (const t of responseBreaches) {
    await db.ticket.update({ where: { id: t.id }, data: { slaResponseBreached: true } });
    await recordEvent(t.id, "SLA_BREACHED", SYSTEM_ACTOR, "Response SLA breached — ticket not acknowledged in time", { clock: "response" });
  }
  for (const t of resolutionBreaches) {
    await db.ticket.update({ where: { id: t.id }, data: { slaResolutionBreached: true } });
    await recordEvent(t.id, "SLA_BREACHED", SYSTEM_ACTOR, "Resolution SLA breached", { clock: "resolution" });
  }
  await remindSilentAssignees(now);
  const urgent = [...responseBreaches, ...resolutionBreaches].filter((t) => ["EMERGENCY", "CRITICAL", "HIGH"].includes(t.priority));
  for (const t of urgent.slice(0, 10)) {
    await notifyRoles(["MAINTENANCE_MANAGER"], {
      title: `SLA breached: ${t.ticketNumber}`,
      body: `${t.priority} ticket ${t.ticketNumber} has breached its SLA.`,
      link: `/tickets/${t.id}`,
      ticketId: t.id,
    });
  }
  return responseBreaches.length + resolutionBreaches.length;
}

/**
 * Assigned but no answer: once half of the response window has passed (at least 10 min),
 * remind the assignee on WhatsApp and tell the managers — they can reassign from the ticket.
 */
async function remindSilentAssignees(now: Date) {
  const candidates = await db.ticket.findMany({
    where: {
      // ASSIGNED = waiting for the (new) assignee to accept, also after a reassignment
      status: "ASSIGNED",
      assignReminderAt: null,
      assignedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
      OR: [{ technicianId: { not: null } }, { contractorId: { not: null } }],
    },
    select: { id: true, ticketNumber: true, priority: true, assignedAt: true, slaResponseDueAt: true, technician: { select: { name: true } }, contractor: { select: { name: true } } },
    take: 50,
  });
  const due = candidates.filter((t) => {
    if (!t.assignedAt) return false;
    const window = t.slaResponseDueAt ? t.slaResponseDueAt.getTime() - t.assignedAt.getTime() : 60 * 60_000;
    return now.getTime() - t.assignedAt.getTime() >= Math.max(10 * 60_000, window / 2);
  });
  if (!due.length) return;
  const { sendAssignmentReminder } = await import("./staff-whatsapp.service");
  for (const t of due) {
    const claimed = await db.ticket.updateMany({ where: { id: t.id, assignReminderAt: null }, data: { assignReminderAt: now } });
    if (claimed.count !== 1) continue; // another request already sent it
    const who = t.technician?.name ?? t.contractor?.name ?? "The assignee";
    await sendAssignmentReminder(t.id).catch((e) => console.error("[sla] reminder failed", e));
    await recordEvent(t.id, "REMINDER_SENT", SYSTEM_ACTOR, `${who} hasn't answered yet — WhatsApp reminder sent`);
    await notifyRoles(["MAINTENANCE_MANAGER"], {
      title: `No answer on ${t.ticketNumber}`,
      body: `${who} hasn't accepted the ${t.priority.toLowerCase()} job yet. Reassign it if needed.`,
      link: `/tickets/${t.id}`,
      ticketId: t.id,
    });
  }
}

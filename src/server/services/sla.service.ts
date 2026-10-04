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

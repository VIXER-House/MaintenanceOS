import { db } from "@/lib/db";
import { OPEN_STATUSES, PRIORITIES } from "@/server/domain/constants";
import { getContractorPerformance } from "./contractor.service";
import { serializeSla } from "./query.service";
import { sweepSlaBreaches } from "./sla.service";

const DAY = 86_400_000;
const MIN = 60_000;

function cairoDayKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

/** All dashboard numbers are computed from live database data. */
export async function getDashboard() {
  await sweepSlaBreaches();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [open, recent, categories, contractors] = await Promise.all([
    db.ticket.findMany({
      where: { status: { in: OPEN_STATUSES } },
      include: { category: { select: { key: true, nameEn: true, nameAr: true } }, unit: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.ticket.findMany({
      where: { OR: [{ createdAt: { gte: since30 } }, { completedAt: { gte: since30 } }] },
      include: { category: { select: { key: true, nameEn: true, nameAr: true } } },
    }),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
    getContractorPerformance(),
  ]);

  const openWithSla = open.map((t) => ({ t, sla: serializeSla(t, now) }));
  const breachedOpen = openWithSla.filter((x) => x.sla.breached);
  const atRisk = openWithSla.filter((x) => x.sla.overall === "AT_RISK");

  const completed30 = recent.filter((t) => t.completedAt && t.completedAt >= since30);
  const acked30 = recent.filter((t) => t.acknowledgedAt && t.createdAt >= since30);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgResolutionMin = avg(completed30.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / MIN));
  const avgResponseMin = avg(acked30.map((t) => (t.acknowledgedAt!.getTime() - t.createdAt.getTime()) / MIN));
  const slaMet30 = completed30.filter((t) => !t.slaResolutionBreached && !t.slaResponseBreached).length;
  const slaCompliance = completed30.length ? slaMet30 / completed30.length : null;

  const costThisMonth = recent
    .filter((t) => t.completedAt && t.completedAt >= monthStart)
    .reduce((s, t) => s + Number(t.finalCost ?? 0), 0);
  const pendingApprovalValue = open
    .filter((t) => t.status === "WAITING_APPROVAL")
    .reduce((s, t) => s + Number(t.estimatedCost ?? 0), 0);

  // Tickets over time (30 days)
  const days: { date: string; created: number; completed: number }[] = [];
  for (let i = 29; i >= 0; i--) days.push({ date: cairoDayKey(new Date(now.getTime() - i * DAY)), created: 0, completed: 0 });
  const dayIdx = new Map(days.map((d, i) => [d.date, i]));
  for (const t of recent) {
    const c = dayIdx.get(cairoDayKey(t.createdAt));
    if (c !== undefined && t.createdAt >= since30) days[c].created++;
    if (t.completedAt) {
      const d = dayIdx.get(cairoDayKey(t.completedAt));
      if (d !== undefined) days[d].completed++;
    }
  }

  // By category (last 30 days + currently open) and cost by category
  const byCategory = categories
    .map((c) => ({
      key: c.key,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      total: recent.filter((t) => t.category?.key === c.key && t.createdAt >= since30).length,
      open: open.filter((t) => t.category?.key === c.key).length,
      cost: recent.filter((t) => t.category?.key === c.key && t.completedAt && t.completedAt >= since30).reduce((s, t) => s + Number(t.finalCost ?? 0), 0),
    }))
    .filter((c) => c.total || c.open || c.cost);

  const byPriority = PRIORITIES.map((p) => ({ priority: p, open: open.filter((t) => t.priority === p).length }));

  // SLA performance per priority (completed in last 30 days)
  const slaByPriority = PRIORITIES.map((p) => {
    const done = completed30.filter((t) => t.priority === p);
    const met = done.filter((t) => !t.slaResolutionBreached && !t.slaResponseBreached).length;
    return { priority: p, met, breached: done.length - met };
  });

  const statusCounts = Object.fromEntries(
    ["NEW", "WAITING_FOR_INFO", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_QUOTATION", "WAITING_APPROVAL", "APPROVED", "REJECTED"].map((s) => [
      s,
      open.filter((t) => t.status === s).length,
    ]),
  );

  const attention = [...breachedOpen, ...atRisk, ...openWithSla.filter((x) => x.t.priority === "EMERGENCY" && !x.sla.breached)]
    .filter((x, i, arr) => arr.findIndex((y) => y.t.id === x.t.id) === i)
    .slice(0, 8)
    .map(({ t, sla }) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      priority: t.priority,
      status: t.status,
      unit: t.unit?.code ?? null,
      category: t.category,
      sla,
    }));

  return {
    generatedAt: now.toISOString(),
    kpis: {
      openTickets: open.length,
      emergencyOpen: open.filter((t) => t.priority === "EMERGENCY" || t.priority === "CRITICAL").length,
      slaBreachesOpen: breachedOpen.length,
      atRisk: atRisk.length,
      avgResolutionMinutes: Math.round(avgResolutionMin),
      avgResponseMinutes: Math.round(avgResponseMin),
      slaCompliance,
      costThisMonth,
      pendingApprovals: open.filter((t) => t.status === "WAITING_APPROVAL").length,
      pendingApprovalValue,
      completed30: completed30.length,
      created30: recent.filter((t) => t.createdAt >= since30).length,
    },
    ticketsOverTime: days,
    byCategory,
    byPriority,
    slaByPriority,
    statusCounts,
    contractors: contractors.slice(0, 6),
    attention,
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

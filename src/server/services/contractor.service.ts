import { db } from "@/lib/db";
import { ACTIVE_WORK_STATUSES } from "@/server/domain/constants";

const MIN = 60_000;

/** Recompute cached contractor KPIs from ticket history. */
export async function recomputeContractorMetrics(contractorId: string) {
  const done = await db.ticket.findMany({
    where: { contractorId, completedAt: { not: null } },
    select: { createdAt: true, assignedAt: true, acknowledgedAt: true, completedAt: true, finalCost: true },
  });
  const resp = done.filter((t) => t.acknowledgedAt).map((t) => (t.acknowledgedAt!.getTime() - (t.assignedAt ?? t.createdAt).getTime()) / MIN);
  const reso = done.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / MIN);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  await db.contractor.update({
    where: { id: contractorId },
    data: {
      avgResponseMinutes: avg(resp),
      avgResolutionMinutes: avg(reso),
      completedJobs: done.length,
      totalCost: done.reduce((s, t) => s + Number(t.finalCost ?? 0), 0),
    },
  });
}

export interface ContractorPerformance {
  id: string;
  name: string;
  nameAr: string | null;
  category: string | null;
  categoryAr: string | null;
  categoryKey: string | null;
  phone: string;
  email: string | null;
  rating: number;
  isActive: boolean;
  avgResponseMinutes: number;
  avgResolutionMinutes: number;
  completedJobs: number;
  totalCost: number;
  openJobs: number;
  slaCompliance: number | null;
  score: number;
}

/** Contractor list with live performance metrics (also used by the dashboard). */
export async function getContractorPerformance(): Promise<ContractorPerformance[]> {
  const contractors = await db.contractor.findMany({
    include: {
      category: true,
      tickets: { select: { status: true, completedAt: true, slaResolutionBreached: true, slaResponseBreached: true } },
    },
    orderBy: { name: "asc" },
  });
  return contractors
    .map((c) => {
      const completed = c.tickets.filter((t) => t.completedAt);
      const met = completed.filter((t) => !t.slaResolutionBreached && !t.slaResponseBreached).length;
      const slaCompliance = completed.length ? met / completed.length : null;
      const responseScore = c.avgResponseMinutes ? Math.max(0, 1 - c.avgResponseMinutes / 480) : 0.5;
      const score = Math.round(((c.rating / 5) * 40 + (slaCompliance ?? 0.7) * 40 + responseScore * 20) * 10) / 10;
      return {
        id: c.id,
        name: c.name,
        nameAr: c.nameAr,
        category: c.category?.nameEn ?? null,
        categoryAr: c.category?.nameAr ?? null,
        categoryKey: c.category?.key ?? null,
        phone: c.phone,
        email: c.email,
        rating: c.rating,
        isActive: c.isActive,
        avgResponseMinutes: c.avgResponseMinutes,
        avgResolutionMinutes: c.avgResolutionMinutes,
        completedJobs: c.completedJobs,
        totalCost: Number(c.totalCost),
        openJobs: c.tickets.filter((t) => (ACTIVE_WORK_STATUSES as string[]).includes(t.status)).length,
        slaCompliance,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

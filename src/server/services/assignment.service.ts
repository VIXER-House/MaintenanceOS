import { db } from "@/lib/db";
import { ACTIVE_WORK_STATUSES } from "@/server/domain/constants";
import { recommendAssignment, type AssignmentRecommendation } from "@/server/engines/assignment/assignment-engine";

/** Loads live workload/availability from the DB and runs the assignment engine. */
export async function getAssignmentRecommendation(categoryKey: string, requiredSkill: string, opts: { excludeTechnicianIds?: string[] } = {}): Promise<AssignmentRecommendation> {
  const [technicians, contractors] = await Promise.all([
    db.technician.findMany({
      where: { isActive: true, ...(opts.excludeTechnicianIds?.length ? { id: { notIn: opts.excludeTechnicianIds } } : {}) },
      include: { _count: { select: { tickets: { where: { status: { in: ACTIVE_WORK_STATUSES } } } } } },
    }),
    db.contractor.findMany({
      include: {
        category: { select: { key: true } },
        _count: { select: { tickets: { where: { status: { in: ACTIVE_WORK_STATUSES } } } } },
      },
    }),
  ]);
  return recommendAssignment({
    categoryKey,
    requiredSkill,
    technicians: technicians.map((t) => ({
      id: t.id,
      name: t.name,
      skills: t.skills,
      status: t.status,
      openTickets: t._count.tickets,
      maxConcurrent: t.maxConcurrent,
    })),
    contractors: contractors.map((c) => ({
      id: c.id,
      name: c.name,
      categoryKey: c.category?.key ?? null,
      rating: c.rating,
      isActive: c.isActive,
      avgResponseMinutes: c.avgResponseMinutes,
      openTickets: c._count.tickets,
    })),
  });
}

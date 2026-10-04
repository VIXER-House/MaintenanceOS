import { requirePageUser, STAFF } from "@/lib/auth";
import { db } from "@/lib/db";
import { listTickets } from "@/server/services/query.service";
import { sweepSlaBreaches } from "@/server/services/sla.service";
import { TicketsView } from "@/features/tickets/tickets-view";

export const dynamic = "force-dynamic";

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser(STAFF);
  const sp = await searchParams;
  await sweepSlaBreaches();
  const filters = {
    status: sp.status,
    priority: sp.priority,
    category: sp.category,
    q: sp.q,
    sla: sp.sla as "breached" | undefined,
    page: Number(sp.page ?? 1),
    pageSize: 25,
  };
  const [result, categories] = await Promise.all([
    listTickets(user, filters),
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, nameEn: true, nameAr: true } }),
  ]);
  return <TicketsView result={result} filters={filters} categories={categories} canCreate={["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"].includes(user.role)} />;
}

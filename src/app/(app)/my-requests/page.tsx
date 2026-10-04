import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import { listTickets } from "@/server/services/query.service";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyRequestsPage() {
  const user = await requirePageUser(["RESIDENT"]);
  const { t, locale } = await getDictionary();
  const result = await listTickets(user, { pageSize: 50 });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t.myRequests.title} subtitle={t.myRequests.subtitle} />
      <Card className="divide-y">
        {result.rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{t.common.noResults}</p>}
        {result.rows.map((r) => (
          <Link key={r.id} href={`/tickets/${r.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/50">
            <CategoryIcon categoryKey={r.category?.key} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground"><span className="font-mono">{r.ticketNumber}</span> · {formatDate(r.createdAt, locale)}</div>
            </div>
            <PriorityBadge priority={r.priority} />
            <StatusBadge status={r.status} />
            {!["CLOSED", "CANCELLED", "COMPLETED"].includes(r.status) && <SlaBadge sla={r.sla} compact />}
          </Link>
        ))}
      </Card>
    </div>
  );
}

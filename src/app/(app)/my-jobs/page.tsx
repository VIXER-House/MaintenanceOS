import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import { listTickets } from "@/server/services/query.service";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { AutoRefresh } from "@/components/domain/auto-refresh";

export const dynamic = "force-dynamic";

export default async function MyJobsPage() {
  const user = await requirePageUser(["TECHNICIAN", "CONTRACTOR", "ADMIN"]);
  const { t } = await getDictionary();
  const [active, done] = await Promise.all([listTickets(user, { status: "open", pageSize: 50 }), listTickets(user, { status: "closed", pageSize: 10 })]);
  return (
    <div className="mx-auto max-w-4xl">
      <AutoRefresh ms={8000} />
      <PageHeader title={t.myJobs.title} subtitle={`${t.myJobs.subtitle} · ${active.total}`} />
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t.myJobs.active}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {active.rows.length === 0 && <p className="text-sm text-muted-foreground">{t.common.noResults}</p>}
        {active.rows.map((r) => (
          <Link key={r.id} href={`/tickets/${r.id}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="num font-mono text-xs font-semibold">{r.ticketNumber}</span>
                  <PriorityBadge priority={r.priority} />
                </div>
                <div className="flex items-center gap-2 font-medium"><CategoryIcon categoryKey={r.category?.key} /> {r.title}</div>
                <div className="text-xs text-muted-foreground">{t.common.unit} {r.unit ?? "—"}</div>
                <div className="flex items-center justify-between"><StatusBadge status={r.status} /><SlaBadge sla={r.sla} compact /></div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold text-muted-foreground">{t.myJobs.done}</h2>
      <Card className="divide-y">
        {done.rows.map((r) => (
          <Link key={r.id} href={`/tickets/${r.id}`} className="flex items-center gap-3 p-3 text-sm hover:bg-muted/50">
            <span className="num font-mono text-xs">{r.ticketNumber}</span>
            <span className="flex-1 truncate">{r.title}</span>
            <StatusBadge status={r.status} />
          </Link>
        ))}
      </Card>
    </div>
  );
}

import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { ACTIVE_WORK_STATUSES } from "@/server/domain/constants";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import { scoreTechnician } from "@/server/engines/assignment/assignment-engine";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TechniciansPage() {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const since = new Date(Date.now() - 30 * 86400_000);
  const techs = await db.technician.findMany({
    include: {
      team: true,
      tickets: { select: { status: true, completedAt: true, slaResolutionBreached: true } },
    },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader title={t.technicians.title} subtitle={t.technicians.subtitle} />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t.detail.technician}</TH>
              <TH>{t.detail.team}</TH>
              <TH>{t.technicians.skills}</TH>
              <TH>{t.technicians.status}</TH>
              <TH>{t.technicians.workload}</TH>
              <TH>{t.technicians.completed}</TH>
              <TH>{t.common.rating}</TH>
            </TR>
          </THead>
          <TBody>
            {techs.map((x) => {
              const open = x.tickets.filter((k) => (ACTIVE_WORK_STATUSES as string[]).includes(k.status)).length;
              const done = x.tickets.filter((k) => k.completedAt && k.completedAt >= since).length;
              const score = scoreTechnician({ id: x.id, name: x.name, skills: x.skills, status: x.status, openTickets: open, maxConcurrent: x.maxConcurrent }, x.skills[0]);
              return (
                <TR key={x.id}>
                  <TD>
                    <div className="font-medium">{locale === "ar" ? x.nameAr ?? x.name : x.name}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{x.phone}</div>
                  </TD>
                  <TD className="text-xs">{x.team ? (locale === "ar" ? x.team.nameAr ?? x.team.name : x.team.name) : "—"}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {x.skills.map((s) => <Badge key={s} variant="muted">{CATEGORY_BY_KEY[s] ? (locale === "ar" ? CATEGORY_BY_KEY[s].nameAr : CATEGORY_BY_KEY[s].nameEn) : s}</Badge>)}
                    </div>
                  </TD>
                  <TD>
                    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", x.status === "AVAILABLE" ? "text-emerald-700" : x.status === "BUSY" ? "text-orange-700" : "text-slate-500")}>
                      <span className={cn("h-2 w-2 rounded-full", x.status === "AVAILABLE" ? "bg-emerald-500" : x.status === "BUSY" ? "bg-orange-500" : "bg-slate-400")} />
                      {t.technicians[x.status]}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-muted"><div className={cn("h-1.5 rounded-full", open >= x.maxConcurrent ? "bg-red-500" : "bg-primary")} style={{ width: `${Math.min(100, (open / x.maxConcurrent) * 100)}%` }} /></div>
                      <span className="num text-xs">{open}/{x.maxConcurrent}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">assignment score {score.score}</div>
                  </TD>
                  <TD className="num">{done}</TD>
                  <TD className="num">★ {x.rating.toFixed(1)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

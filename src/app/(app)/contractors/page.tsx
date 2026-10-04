import { requirePageUser, MANAGERS } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import { getContractorPerformance } from "@/server/services/contractor.service";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const rows = await getContractorPerformance();
  return (
    <div>
      <PageHeader title={t.contractors.title} subtitle={t.contractors.subtitle} />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t.detail.contractor}</TH>
              <TH>{t.common.category}</TH>
              <TH>{t.common.rating}</TH>
              <TH>{t.contractors.avgResponse}</TH>
              <TH>{t.contractors.avgResolution}</TH>
              <TH>{t.contractors.completedJobs}</TH>
              <TH>{t.contractors.openJobs}</TH>
              <TH>{t.contractors.slaCompliance}</TH>
              <TH>{t.contractors.totalCost}</TH>
              <TH>{t.dashboard.score}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <div className="font-medium">{locale === "ar" ? c.nameAr ?? c.name : c.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{c.phone} · {c.email}</div>
                  <div className={cn("text-[11px]", c.isActive ? "text-emerald-700" : "text-slate-400")}>{c.isActive ? t.contractors.active : t.contractors.inactive}</div>
                </TD>
                <TD className="text-xs">{locale === "ar" ? c.categoryAr : c.category}</TD>
                <TD className="num">★ {c.rating.toFixed(1)}</TD>
                <TD className="num text-xs">{formatMinutes(c.avgResponseMinutes, locale)}</TD>
                <TD className="num text-xs">{formatMinutes(c.avgResolutionMinutes, locale)}</TD>
                <TD className="num">{c.completedJobs}</TD>
                <TD className="num">{c.openJobs}</TD>
                <TD className="num text-xs">{c.slaCompliance === null ? "—" : `${Math.round(c.slaCompliance * 100)}%`}</TD>
                <TD className="num whitespace-nowrap text-xs">{formatMoney(c.totalCost, locale)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${c.score}%` }} /></div>
                    <span className="num text-xs font-semibold">{c.score}</span>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Score = rating 40% + SLA compliance 40% + response speed 20%. Metrics are recomputed from ticket history whenever a contractor job completes.</p>
    </div>
  );
}

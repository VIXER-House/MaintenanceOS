"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Banknote, CheckCircle2, ClipboardList, Flame, MessageCircle, PlayCircle, Timer, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/domain/page-header";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { useI18n } from "@/lib/i18n/client";
import { formatMinutes, formatMoney, formatNumber, formatTime } from "@/lib/format";
import { PRIORITY_LABELS } from "@/server/domain/labels";
import type { DashboardData } from "@/server/services/dashboard.service";
import { CategoryBars, CostBars, SlaStack, TicketsOverTime } from "./charts";
import { cn } from "@/lib/utils";

function Kpi({ label, value, sub, icon: Icon, tone, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: React.ElementType; tone?: "danger" | "warn"; href?: string }) {
  const body = (
    <Card className={cn("h-full transition-colors", href && "hover:border-primary/40")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {label}
          <Icon className={cn("h-4 w-4", tone === "danger" ? "text-red-600" : tone === "warn" ? "text-orange-600" : "text-muted-foreground")} />
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function DashboardView({ data }: { data: DashboardData }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const k = data.kpis;
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div>
      <PageHeader
        title={t.dashboard.title}
        subtitle={t.dashboard.subtitle}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/whatsapp"><MessageCircle /> {t.dashboard.openSimulator}</Link>
            </Button>
            <Button asChild>
              <Link href="/demo"><PlayCircle /> {t.dashboard.runDemo}</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t.dashboard.openTickets} value={formatNumber(k.openTickets, locale)} sub={`${k.pendingApprovals} ${t.dashboard.pendingApprovals}`} icon={ClipboardList} href="/tickets?status=open" />
        <Kpi label={t.dashboard.emergency} value={formatNumber(k.emergencyOpen, locale)} icon={Flame} tone={k.emergencyOpen ? "danger" : undefined} href="/tickets?status=open&priority=EMERGENCY" />
        <Kpi label={t.dashboard.slaBreaches} value={formatNumber(k.slaBreachesOpen, locale)} sub={`${k.atRisk} ${t.dashboard.atRisk}`} icon={AlertTriangle} tone={k.slaBreachesOpen ? "danger" : undefined} href="/tickets?status=open&sla=breached" />
        <Kpi label={t.dashboard.avgResponse} value={formatMinutes(k.avgResponseMinutes, locale)} sub={`${t.dashboard.slaCompliance}: ${k.slaCompliance === null ? "—" : Math.round(k.slaCompliance * 100) + "%"}`} icon={Zap} />
        <Kpi label={t.dashboard.avgResolution} value={formatMinutes(k.avgResolutionMinutes, locale)} sub={`${k.completed30} ${t.dashboard.completedSeries}`} icon={Timer} />
        <Kpi label={t.dashboard.costMonth} value={formatMoney(k.costThisMonth, locale)} sub={`${formatMoney(k.pendingApprovalValue, locale)} ${t.dashboard.pendingApprovals}`} icon={Banknote} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t.dashboard.ticketsOverTime}</CardTitle>
            <CardDescription>{k.created30} {t.dashboard.createdSeries.toLowerCase()} · {k.completed30} {t.dashboard.completedSeries.toLowerCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            <TicketsOverTime data={data.ticketsOverTime} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.needsAttention}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.attention.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t.dashboard.noAttention}</p>}
            {data.attention.map((a) => (
              <Link key={a.id} href={`/tickets/${a.id}`} className="flex items-start gap-2.5 rounded-md p-2 hover:bg-muted">
                <CategoryIcon categoryKey={a.category?.key} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num whitespace-nowrap text-xs font-semibold">{a.ticketNumber}</span>
                    <PriorityBadge priority={a.priority} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{a.title}{a.unit ? ` · ${a.unit}` : ""}</div>
                </div>
                <SlaBadge sla={a.sla} compact />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t.dashboard.byCategory}</CardTitle><CardDescription>30d</CardDescription></CardHeader>
          <CardContent><CategoryBars data={data.byCategory} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t.dashboard.slaPerformance}</CardTitle><CardDescription>30d</CardDescription></CardHeader>
          <CardContent><SlaStack data={data.slaByPriority} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t.dashboard.byPriority}</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {data.byPriority.map((p) => {
              const max = Math.max(1, ...data.byPriority.map((x) => x.open));
              return (
                <Link key={p.priority} href={`/tickets?status=open&priority=${p.priority}`} className="group flex items-center gap-3">
                  <div className="w-24"><PriorityBadge priority={p.priority} /></div>
                  <div className="h-2 flex-1 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-slate-700 group-hover:bg-primary" style={{ width: `${(p.open / max) * 100}%` }} />
                  </div>
                  <span className="num w-6 text-end text-sm font-medium">{p.open}</span>
                </Link>
              );
            })}
            <div className="flex flex-wrap gap-1.5 pt-3">
              {Object.entries(data.statusCounts).filter(([, n]) => n > 0).map(([s, n]) => (
                <Link key={s} href={`/tickets?status=${s}`} className="flex items-center gap-1"><StatusBadge status={s as never} /><span className="num text-xs text-muted-foreground">{n}</span></Link>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="xl:col-span-1">
          <CardHeader><CardTitle>{t.dashboard.costByCategory}</CardTitle><CardDescription>30d</CardDescription></CardHeader>
          <CardContent><CostBars data={data.byCategory} /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t.dashboard.contractorPerformance}</CardTitle>
            <Link href="/contractors" className="text-xs text-primary hover:underline">{t.common.view} <ArrowUpRight className="inline h-3 w-3 rtl:-scale-x-100" /></Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {data.contractors.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{locale === "ar" ? c.nameAr ?? c.name : c.name}</div>
                    <div className="text-xs text-muted-foreground">{locale === "ar" ? c.categoryAr : c.category} · ★ {c.rating.toFixed(1)} · {c.completedJobs} {t.dashboard.jobs}</div>
                  </div>
                  <div className="hidden text-end text-xs sm:block">
                    <div className="text-muted-foreground">{t.dashboard.response}</div>
                    <div className="num font-medium">{formatMinutes(c.avgResponseMinutes, locale)}</div>
                  </div>
                  <div className="hidden w-28 text-end text-xs sm:block">
                    <div className="text-muted-foreground">{t.contractors.slaCompliance}</div>
                    <div className="num font-medium">{c.slaCompliance === null ? "—" : `${Math.round(c.slaCompliance * 100)}%`}</div>
                  </div>
                  <div className="w-24">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{t.dashboard.score}</span><span className="num font-semibold text-foreground">{c.score}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${c.score}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1 text-[11px] text-muted-foreground"><CheckCircle2 className="h-3 w-3" /> {formatTime(data.generatedAt, locale)} · {PRIORITY_LABELS.EMERGENCY[locale]} / {PRIORITY_LABELS.CRITICAL[locale]}</p>
    </div>
  );
}

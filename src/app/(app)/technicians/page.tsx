import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileSpreadsheet } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { ACTIVE_WORK_STATUSES } from "@/server/domain/constants";
import { scoreTechnician } from "@/server/engines/assignment/assignment-engine";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EntityFormButton, ListControls, RowActions } from "@/features/manage/entity-ui";
import { teamFields, technicianFields } from "@/lib/manage/fields";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TechniciansPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const since = new Date(Date.now() - 30 * 86400_000);
  const where: Prisma.TechnicianWhereInput = {
    ...(sp.archived === "1" ? {} : { isActive: true }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { nameAr: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const [techs, categories, teams] = await Promise.all([
    db.technician.findMany({
      where,
      include: { team: true, user: { select: { email: true } }, tickets: { select: { status: true, completedAt: true, slaResolutionBreached: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.category.findMany({ where: { isActive: true, key: { not: "OTHER" } }, orderBy: { sortOrder: "asc" } }),
    db.team.findMany({ include: { category: true, _count: { select: { technicians: true } } }, orderBy: { name: "asc" } }),
  ]);
  const catLabel = new Map(categories.map((c) => [c.key, locale === "ar" ? c.nameAr : c.nameEn]));
  const skillOpts = categories.map((c) => ({ value: c.key, label: locale === "ar" ? c.nameAr : c.nameEn }));
  const teamOpts = teams.map((x) => ({ value: x.id, label: locale === "ar" ? x.nameAr ?? x.name : x.name }));
  const catOpts = categories.map((c) => ({ value: c.key, label: locale === "ar" ? c.nameAr : c.nameEn }));
  const fields = technicianFields(t, skillOpts, teamOpts);
  const tFields = teamFields(t, catOpts);
  return (
    <div>
      <PageHeader
        title={t.technicians.title}
        subtitle={t.technicians.subtitle}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/import?type=technicians"><FileSpreadsheet /> {t.residentsImport.button}</Link></Button>
            <EntityFormButton entity="technicians" fields={fields} title={`${t.manage.add} · ${t.technicians.title}`} defaults={{ status: "AVAILABLE", maxConcurrent: 5, skills: [] }} />
          </>
        }
      />
      <ListControls />
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
              <TH />
            </TR>
          </THead>
          <TBody>
            {techs.length === 0 && <TR><TD colSpan={8} className="py-8 text-center text-sm text-muted-foreground">{t.manage.noResults}</TD></TR>}
            {techs.map((x) => {
              const open = x.tickets.filter((k) => (ACTIVE_WORK_STATUSES as string[]).includes(k.status)).length;
              const done = x.tickets.filter((k) => k.completedAt && k.completedAt >= since).length;
              const score = scoreTechnician({ id: x.id, name: x.name, skills: x.skills, status: x.status, openTickets: open, maxConcurrent: x.maxConcurrent }, x.skills[0]);
              return (
                <TR key={x.id} className={x.isActive ? "" : "opacity-60"}>
                  <TD>
                    <div className="flex items-center gap-2 font-medium">{locale === "ar" ? x.nameAr ?? x.name : x.name}{!x.isActive && <Badge variant="outline">{t.manage.archived}</Badge>}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{x.phone} · {x.user.email}</div>
                  </TD>
                  <TD className="text-xs">{x.team ? (locale === "ar" ? x.team.nameAr ?? x.team.name : x.team.name) : "—"}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {x.skills.map((s) => <Badge key={s} variant="muted">{s === "GENERAL" ? t.manage.f.general : catLabel.get(s) ?? s}</Badge>)}
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
                  <TD>
                    <RowActions
                      entity="technicians"
                      id={x.id}
                      name={x.name}
                      active={x.isActive}
                      canArchive
                      canResetPassword
                      edit={{
                        title: `${t.manage.edit} · ${x.name}`,
                        fields,
                        record: { name: x.name, nameAr: x.nameAr ?? "", phone: x.phone, email: x.user.email, skills: x.skills, teamId: x.teamId ?? "", maxConcurrent: x.maxConcurrent, status: x.status },
                      }}
                    />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t.manage.teams}</CardTitle>
          <EntityFormButton entity="teams" fields={tFields} title={`${t.manage.add} · ${t.manage.teams}`} variant="outline" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>{t.manage.f.name}</TH><TH>{t.manage.f.category}</TH><TH>{t.technicians.title}</TH><TH /></TR></THead>
            <TBody>
              {teams.map((x) => (
                <TR key={x.id}>
                  <TD className="font-medium">{locale === "ar" ? x.nameAr ?? x.name : x.name}</TD>
                  <TD className="text-xs">{x.category ? (locale === "ar" ? x.category.nameAr : x.category.nameEn) : "—"}</TD>
                  <TD className="num text-xs">{x._count.technicians}</TD>
                  <TD>
                    <RowActions entity="teams" id={x.id} name={x.name} edit={{ title: `${t.manage.edit} · ${x.name}`, fields: tFields, record: { name: x.name, nameAr: x.nameAr ?? "", category: x.category?.key ?? "" } }} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

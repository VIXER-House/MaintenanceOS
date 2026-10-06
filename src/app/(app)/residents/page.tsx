import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileSpreadsheet, MessageCircle } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { normalizePhoneNumber } from "@/lib/import/core";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VerifyResidentButton } from "@/features/residents/verify-button";
import { EntityFormButton, ListControls, Pager, RowActions } from "@/features/manage/entity-ui";
import { residentFields } from "@/lib/manage/fields";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function ResidentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; archived?: string; filter?: string }> }) {
  await requirePageUser(MANAGERS);
  const { t } = await getDictionary();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const archived = sp.archived === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const phone = q ? normalizePhoneNumber(q) : null;
  const where: Prisma.ResidentWhereInput = {
    ...(archived ? {} : { isActive: true }),
    ...(sp.filter === "unverified" ? { verified: false } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/[^\d+]/g, "") || q } },
            ...(phone ? [{ phone }] : []),
            { unit: { code: { contains: q, mode: "insensitive" } } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, residents] = await Promise.all([
    db.resident.count({ where }),
    db.resident.findMany({
      where,
      include: { unit: { include: { building: true } }, _count: { select: { tickets: true } }, tickets: { where: { status: { in: OPEN_STATUSES } }, select: { id: true } } },
      orderBy: [{ isActive: "desc" }, { verified: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const fields = residentFields(t);
  return (
    <div>
      <PageHeader
        title={t.residents.title}
        subtitle={t.residents.subtitle}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/import?type=residents"><FileSpreadsheet /> {t.residentsImport.button}</Link></Button>
            <EntityFormButton entity="residents" fields={fields} title={`${t.manage.add} · ${t.residents.title}`} defaults={{ isOwner: "true", language: "ar", verified: true }} />
          </>
        }
      />
      <ListControls />
      <Card>
        <Table>
          <THead>
            <TR><TH>{t.common.resident}</TH><TH>{t.common.unit}</TH><TH>{t.common.phone}</TH><TH>{t.residents.language}</TH><TH>{t.residents.tickets}</TH><TH /></TR>
          </THead>
          <TBody>
            {residents.length === 0 && (
              <TR><TD colSpan={6} className="py-8 text-center text-sm text-muted-foreground">{t.manage.noResults}</TD></TR>
            )}
            {residents.map((r) => (
              <TR key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <TD>
                  <div className="flex items-center gap-2 font-medium">
                    {r.nameAr}
                    {!r.isActive && <Badge variant="outline">{t.manage.archived}</Badge>}
                    {!r.verified && r.isActive && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{t.residents.unverified}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.name}</div>
                </TD>
                <TD className="text-xs">{r.unit ? `${r.unit.code} · ${r.unit.type}` : <span className="text-amber-700">{t.residents.noUnit}</span>}</TD>
                <TD className="num text-xs" dir="ltr">{r.phone}</TD>
                <TD className="text-xs uppercase">{r.language}</TD>
                <TD className="num text-xs">{r.tickets.length} {t.common.open.toLowerCase()} / {r._count.tickets}</TD>
                <TD>
                  <div className="flex items-center justify-end gap-1">
                    {!r.verified && r.unit && r.isActive && <VerifyResidentButton residentId={r.id} />}
                    {r.isActive && <Button asChild variant="ghost" size="sm" title={t.residents.openSim}><Link href={`/whatsapp?resident=${r.id}`}><MessageCircle /></Link></Button>}
                    <RowActions
                      entity="residents"
                      id={r.id}
                      name={r.nameAr ?? r.name}
                      active={r.isActive}
                      canArchive
                      edit={{
                        title: `${t.manage.edit} · ${r.nameAr ?? r.name}`,
                        fields,
                        record: { name: r.name, nameAr: r.nameAr, phone: r.phone, unit: r.unit?.code ?? "", isOwner: String(r.isOwner), language: r.language, email: r.email ?? "", verified: r.verified },
                      }}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
    </div>
  );
}

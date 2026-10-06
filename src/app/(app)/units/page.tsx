import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileSpreadsheet } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityFormButton, ListControls, Pager, RowActions } from "@/features/manage/entity-ui";
import { buildingFields, unitFields } from "@/lib/manage/fields";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; building?: string }> }) {
  await requirePageUser(MANAGERS);
  const { t } = await getDictionary();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.UnitWhereInput = {
    ...(sp.building ? { building: { code: sp.building } } : {}),
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { type: { contains: q, mode: "insensitive" } }, { building: { code: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [buildings, total, units] = await Promise.all([
    db.building.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { units: true, assets: true } } } }),
    db.unit.count({ where }),
    db.unit.findMany({
      where,
      include: { building: { select: { code: true } }, _count: { select: { residents: { where: { isActive: true } }, tickets: true, assets: true } } },
      orderBy: { code: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const bFields = buildingFields(t);
  const uFields = unitFields(t);
  return (
    <div>
      <PageHeader
        title={t.manage.units}
        subtitle={t.manage.unitsSubtitle}
        actions={<Button asChild variant="outline"><Link href="/import?type=units"><FileSpreadsheet /> {t.residentsImport.button}</Link></Button>}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t.manage.buildings} <span className="text-sm font-normal text-muted-foreground">({buildings.length})</span></CardTitle>
            <EntityFormButton entity="buildings" fields={bFields} title={`${t.manage.add} · ${t.manage.buildings}`} defaults={{ floors: 5 }} variant="outline" />
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-auto p-0">
            <Table>
              <THead><TR><TH>{t.manage.f.code}</TH><TH>{t.manage.f.floors}</TH><TH>{t.manage.unitsTable}</TH><TH /></TR></THead>
              <TBody>
                {buildings.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Link href={`/units?building=${encodeURIComponent(b.code)}`} className="font-medium text-primary hover:underline" dir="ltr">{b.code}</Link>
                      {b.name && b.name !== b.code && <div className="text-xs text-muted-foreground">{b.name}</div>}
                    </TD>
                    <TD className="num text-xs">{b.floors}</TD>
                    <TD className="num text-xs">{b._count.units}</TD>
                    <TD>
                      <RowActions entity="buildings" id={b.id} name={b.code} edit={{ title: `${t.manage.edit} · ${b.code}`, fields: bFields, record: { code: b.code, name: b.name ?? "", floors: b.floors } }} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <ListControls showArchivedToggle={false} extra={sp.building ? <Button asChild variant="ghost" size="sm"><Link href="/units">{t.manage.f.building}: {sp.building} ✕</Link></Button> : null} />
            <EntityFormButton entity="units" fields={uFields} title={`${t.manage.add} · ${t.manage.unitsTable}`} defaults={{ floor: 0, type: "Apartment", building: sp.building ?? "" }} />
          </div>
          <Card>
            <Table>
              <THead><TR><TH>{t.manage.f.code}</TH><TH>{t.manage.f.building}</TH><TH>{t.manage.f.floor}</TH><TH>{t.manage.f.unitType}</TH><TH>{t.manage.f.area}</TH><TH>{t.residents.title}</TH><TH /></TR></THead>
              <TBody>
                {units.length === 0 && <TR><TD colSpan={7} className="py-8 text-center text-sm text-muted-foreground">{t.manage.noResults}</TD></TR>}
                {units.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium" dir="ltr">{u.code}</TD>
                    <TD className="text-xs" dir="ltr">{u.building.code}</TD>
                    <TD className="num text-xs">{u.floor}</TD>
                    <TD className="text-xs">{u.type}</TD>
                    <TD className="num text-xs">{u.areaSqm ?? "—"}</TD>
                    <TD className="num text-xs"><Link href={`/residents?q=${encodeURIComponent(u.code)}`} className="hover:underline">{u._count.residents}</Link></TD>
                    <TD>
                      <RowActions entity="units" id={u.id} name={u.code} edit={{ title: `${t.manage.edit} · ${u.code}`, fields: uFields, record: { code: u.code, building: u.building.code, floor: u.floor, type: u.type, areaSqm: u.areaSqm } }} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileSpreadsheet } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CategoryIcon } from "@/components/domain/category-icon";
import { AssetStatusBadge } from "@/features/assets/asset-status";
import { EntityFormButton, ListControls, Pager, RowActions } from "@/features/manage/entity-ui";
import { assetFields } from "@/lib/manage/fields";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; archived?: string }> }) {
  const user = await requirePageUser(["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER", "TECHNICIAN"]);
  const canManage = MANAGERS.includes(user.role);
  const { t, locale } = await getDictionary();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AssetWhereInput = {
    ...(sp.archived === "1" ? {} : { status: { not: "RETIRED" } }),
    ...(q
      ? {
          OR: [
            { assetCode: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { nameAr: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { unit: { code: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, assets, categories] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      include: { category: true, unit: true, building: true, history: { orderBy: { date: "desc" }, take: 1 }, _count: { select: { history: true, tickets: true } } },
      orderBy: [{ type: "asc" }, { assetCode: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    canManage ? db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
  ]);
  const fields = assetFields(t, categories.map((c) => ({ value: c.key, label: locale === "ar" ? c.nameAr : c.nameEn })));
  return (
    <div>
      <PageHeader
        title={t.assets.title}
        subtitle={t.assets.subtitle}
        actions={
          canManage ? (
            <>
              <Button asChild variant="outline"><Link href="/import?type=assets"><FileSpreadsheet /> {t.residentsImport.button}</Link></Button>
              <EntityFormButton entity="assets" fields={fields} title={`${t.manage.add} · ${t.assets.title}`} defaults={{ status: "OPERATIONAL" }} />
            </>
          ) : null
        }
      />
      <ListControls showArchivedToggle={canManage} />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t.assets.code}</TH>
              <TH>{t.common.asset}</TH>
              <TH>{t.common.location}</TH>
              <TH>{t.assets.manufacturer}</TH>
              <TH>{t.assets.warranty}</TH>
              <TH>{t.assets.lastService}</TH>
              <TH>{t.common.status}</TH>
              {canManage && <TH />}
            </TR>
          </THead>
          <TBody>
            {assets.length === 0 && <TR><TD colSpan={8} className="py-8 text-center text-sm text-muted-foreground">{t.manage.noResults}</TD></TR>}
            {assets.map((a) => {
              const inWarranty = a.warrantyExpiry && a.warrantyExpiry > new Date();
              return (
                <TR key={a.id} className={a.status === "RETIRED" ? "opacity-60" : ""}>
                  <TD><Link href={`/assets/${a.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{a.assetCode}</Link></TD>
                  <TD>
                    <div className="flex items-center gap-2"><CategoryIcon categoryKey={a.category?.key} /><div><div className="font-medium">{locale === "ar" ? a.nameAr ?? a.name : a.name}</div><div className="text-xs text-muted-foreground">{a.type} · {a._count.history} records · {a._count.tickets} tickets</div></div></div>
                  </TD>
                  <TD className="text-xs">{a.unit ? a.unit.code : a.building ? `Bldg ${a.building.code}` : "Compound"} · {a.location}</TD>
                  <TD className="text-xs">{a.manufacturer} {a.model}</TD>
                  <TD className="text-xs">{inWarranty ? <span className="text-emerald-700">{t.assets.underWarranty} · {formatDate(a.warrantyExpiry, locale)}</span> : <span className="text-muted-foreground">{t.assets.expired}</span>}</TD>
                  <TD className="text-xs">{a.history[0] ? <>{formatDate(a.history[0].date, locale)}<div className="max-w-[200px] truncate text-muted-foreground">{a.history[0].description}</div></> : "—"}</TD>
                  <TD><AssetStatusBadge status={a.status} /></TD>
                  {canManage && (
                    <TD>
                      <RowActions
                        entity="assets"
                        id={a.id}
                        name={a.assetCode}
                        active={a.status !== "RETIRED"}
                        canArchive
                        edit={{
                          title: `${t.manage.edit} · ${a.assetCode}`,
                          fields,
                          record: {
                            assetCode: a.assetCode,
                            type: a.type,
                            name: a.name,
                            nameAr: a.nameAr ?? "",
                            category: a.category?.key ?? "",
                            status: a.status,
                            building: a.unit ? "" : a.building?.code ?? "",
                            unit: a.unit?.code ?? "",
                            location: a.location,
                            installationDate: day(a.installationDate),
                            warrantyExpiry: day(a.warrantyExpiry),
                            manufacturer: a.manufacturer ?? "",
                            model: a.model ?? "",
                            serialNumber: a.serialNumber ?? "",
                          },
                        }}
                      />
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
    </div>
  );
}

import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CategoryIcon } from "@/components/domain/category-icon";
import { AssetStatusBadge } from "@/features/assets/asset-status";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  await requirePageUser(["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER", "TECHNICIAN"]);
  const { t, locale } = await getDictionary();
  const assets = await db.asset.findMany({
    include: { category: true, unit: true, building: true, history: { orderBy: { date: "desc" }, take: 1 }, _count: { select: { history: true, tickets: true } } },
    orderBy: [{ type: "asc" }, { assetCode: "asc" }],
  });
  return (
    <div>
      <PageHeader title={t.assets.title} subtitle={`${t.assets.subtitle} · ${assets.length}`} />
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
            </TR>
          </THead>
          <TBody>
            {assets.map((a) => {
              const inWarranty = a.warrantyExpiry && a.warrantyExpiry > new Date();
              return (
                <TR key={a.id}>
                  <TD><Link href={`/assets/${a.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{a.assetCode}</Link></TD>
                  <TD>
                    <div className="flex items-center gap-2"><CategoryIcon categoryKey={a.category?.key} /><div><div className="font-medium">{locale === "ar" ? a.nameAr ?? a.name : a.name}</div><div className="text-xs text-muted-foreground">{a.type} · {a._count.history} records · {a._count.tickets} tickets</div></div></div>
                  </TD>
                  <TD className="text-xs">{a.unit ? a.unit.code : a.building ? `Bldg ${a.building.code}` : "Compound"} · {a.location}</TD>
                  <TD className="text-xs">{a.manufacturer} {a.model}</TD>
                  <TD className="text-xs">{inWarranty ? <span className="text-emerald-700">{t.assets.underWarranty} · {formatDate(a.warrantyExpiry, locale)}</span> : <span className="text-muted-foreground">{t.assets.expired}</span>}</TD>
                  <TD className="text-xs">{a.history[0] ? <>{formatDate(a.history[0].date, locale)}<div className="max-w-[200px] truncate text-muted-foreground">{a.history[0].description}</div></> : "—"}</TD>
                  <TD><AssetStatusBadge status={a.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

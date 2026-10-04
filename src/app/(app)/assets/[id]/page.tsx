import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/domain/category-icon";
import { PriorityBadge, StatusBadge } from "@/components/domain/badges";
import { AssetStatusBadge } from "@/features/assets/asset-status";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser(["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER", "TECHNICIAN"]);
  const { t, locale } = await getDictionary();
  const { id } = await params;
  const a = await db.asset.findUnique({
    where: { id },
    include: {
      category: true,
      unit: true,
      building: true,
      history: { orderBy: { date: "desc" }, include: { ticket: { select: { id: true, ticketNumber: true } } } },
      tickets: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!a) notFound();
  const totalCost = a.history.reduce((s, h) => s + Number(h.cost ?? 0), 0);
  const specs: [string, string][] = [
    [t.assets.type, a.type],
    [t.common.location, `${a.unit ? a.unit.code : a.building ? `Building ${a.building.code}` : "Compound"} · ${a.location}`],
    [t.assets.manufacturer, a.manufacturer ?? "—"],
    [t.assets.model, a.model ?? "—"],
    [t.assets.serial, a.serialNumber ?? "—"],
    [t.assets.installed, formatDate(a.installationDate, locale)],
    [t.assets.warranty, formatDate(a.warrantyExpiry, locale)],
    [t.common.total, formatMoney(totalCost, locale)],
  ];
  return (
    <div>
      <Link href="/assets" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {t.common.back}</Link>
      <PageHeader
        title={<span className="flex items-center gap-2"><CategoryIcon categoryKey={a.category?.key} className="h-5 w-5" /> <span className="font-mono">{a.assetCode}</span> · {locale === "ar" ? a.nameAr ?? a.name : a.name}</span>}
        actions={<AssetStatusBadge status={a.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t.common.asset}</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {specs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-end font-medium">{v}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t.assets.history} · {a.history.length}</CardTitle></CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-s ps-5">
              {a.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -start-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="num font-medium text-foreground">{formatDate(h.date, locale)}</span>
                    <Badge variant="muted">{h.type}</Badge>
                    {h.ticket && <Link href={`/tickets/${h.ticket.id}`} className="font-mono text-primary hover:underline">{h.ticket.ticketNumber}</Link>}
                  </div>
                  <div className="mt-0.5 text-sm">{h.description}</div>
                  <div className="text-xs text-muted-foreground">{h.performedBy}{h.cost !== null ? ` · ${formatMoney(Number(h.cost), locale)}` : ""}</div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>{t.assets.tickets}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {a.tickets.length === 0 && <p className="text-sm text-muted-foreground">{t.common.noResults}</p>}
            {a.tickets.map((x) => (
              <Link key={x.id} href={`/tickets/${x.id}`} className="flex items-center gap-3 rounded-md p-2 text-sm hover:bg-muted">
                <span className="num font-mono text-xs font-semibold">{x.ticketNumber}</span>
                <span className="flex-1 truncate">{x.title}</span>
                <PriorityBadge priority={x.priority} />
                <StatusBadge status={x.status} />
                <span className="text-xs text-muted-foreground">{formatDate(x.createdAt, locale)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

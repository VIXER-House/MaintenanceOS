import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ResidentsPage() {
  await requirePageUser(MANAGERS);
  const { t } = await getDictionary();
  const residents = await db.resident.findMany({
    include: { unit: { include: { building: true } }, _count: { select: { tickets: true } }, tickets: { where: { status: { in: OPEN_STATUSES } }, select: { id: true } } },
    orderBy: { unit: { code: "asc" } },
  });
  return (
    <div>
      <PageHeader title={t.residents.title} subtitle={`${t.residents.subtitle} · ${residents.length}`} />
      <Card>
        <Table>
          <THead>
            <TR><TH>{t.common.resident}</TH><TH>{t.common.unit}</TH><TH>{t.common.phone}</TH><TH>{t.residents.language}</TH><TH>{t.residents.tickets}</TH><TH /></TR>
          </THead>
          <TBody>
            {residents.map((r) => (
              <TR key={r.id}>
                <TD><div className="font-medium">{r.nameAr}</div><div className="text-xs text-muted-foreground">{r.name}</div></TD>
                <TD className="text-xs">{r.unit.code} · {r.unit.type}</TD>
                <TD className="num text-xs" dir="ltr">{r.phone}</TD>
                <TD className="text-xs uppercase">{r.language}</TD>
                <TD className="num text-xs">{r.tickets.length} {t.common.open.toLowerCase()} / {r._count.tickets}</TD>
                <TD className="text-end">
                  <Button asChild variant="outline" size="sm"><Link href={`/whatsapp?resident=${r.id}`}><MessageCircle /> {t.residents.openSim}</Link></Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

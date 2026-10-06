import Link from "next/link";
import { FileSpreadsheet, MessageCircle } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VerifyResidentButton } from "@/features/residents/verify-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ResidentsPage() {
  await requirePageUser(MANAGERS);
  const { t } = await getDictionary();
  const residents = await db.resident.findMany({
    include: { unit: { include: { building: true } }, _count: { select: { tickets: true } }, tickets: { where: { status: { in: OPEN_STATUSES } }, select: { id: true } } },
    orderBy: [{ verified: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div>
      <PageHeader
        title={t.residents.title}
        subtitle={`${t.residents.subtitle} · ${residents.length}`}
        actions={<Button asChild><Link href="/import?type=residents"><FileSpreadsheet /> {t.residentsImport.button}</Link></Button>}
      />
      <Card>
        <Table>
          <THead>
            <TR><TH>{t.common.resident}</TH><TH>{t.common.unit}</TH><TH>{t.common.phone}</TH><TH>{t.residents.language}</TH><TH>{t.residents.tickets}</TH><TH /></TR>
          </THead>
          <TBody>
            {residents.map((r) => (
              <TR key={r.id}>
                <TD>
                  <div className="flex items-center gap-2 font-medium">
                    {r.nameAr}
                    {!r.verified && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{t.residents.unverified}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.name}</div>
                </TD>
                <TD className="text-xs">{r.unit ? `${r.unit.code} · ${r.unit.type}` : <span className="text-amber-700">{t.residents.noUnit}</span>}</TD>
                <TD className="num text-xs" dir="ltr">{r.phone}</TD>
                <TD className="text-xs uppercase">{r.language}</TD>
                <TD className="num text-xs">{r.tickets.length} {t.common.open.toLowerCase()} / {r._count.tickets}</TD>
                <TD className="space-x-2 whitespace-nowrap text-end rtl:space-x-reverse">
                  {!r.verified && r.unit && <VerifyResidentButton residentId={r.id} />}
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

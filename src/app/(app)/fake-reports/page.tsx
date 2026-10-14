import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requirePageUser, MANAGERS } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import { listFakeReports } from "@/server/services/fake-report.service";
import { PageHeader } from "@/components/domain/page-header";
import { StatusBadge } from "@/components/domain/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BlockButton, BlockNumberDialog, ReviewButtons, UnblockButton } from "@/features/fake/fake-actions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS = ["PENDING", "CONFIRMED", "DISMISSED", "ALL"] as const;

export default async function FakeReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const sp = await searchParams;
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof FILTERS)[number]) : "PENDING";
  const data = await listFakeReports({ status });
  const label: Record<(typeof FILTERS)[number], string> = { PENDING: t.fake.pending, CONFIRMED: t.fake.confirmed, DISMISSED: t.fake.dismissed, ALL: t.fake.all };

  return (
    <div className="space-y-6">
      <PageHeader title={t.fake.title} subtitle={t.fake.subtitle} actions={<BlockNumberDialog />} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-600" /> {t.fake.nav}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f}
                href={`/fake-reports?status=${f}`}
                className={cn("rounded-md border px-2.5 py-1 text-xs", f === status ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {label[f]}
                {f === "PENDING" && data.pending > 0 && <span className="num ms-1 font-semibold">({data.pending})</span>}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {data.reports.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t.fake.noReports}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t.fake.phone}</TH>
                  <TH>{t.fake.ticket}</TH>
                  <TH>{t.fake.reportedBy}</TH>
                  <TH>{t.fake.reason}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {data.reports.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <div className="num font-medium" dir="ltr">{r.phone}</div>
                      <div className="text-xs text-muted-foreground">{r.residentName}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!r.residentVerified && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{t.fake.unverifiedNumber}</Badge>}
                        {r.blocked && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">{t.fake.blocked}</Badge>}
                        {r.reportsForPhone > 1 && <Badge variant="muted">{t.fake.reportsForPhone.replace("{n}", String(r.reportsForPhone))}</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <Link href={`/tickets/${r.ticket.id}`} className="num font-mono text-xs text-primary hover:underline">{r.ticket.number}</Link>
                      <div className="max-w-[220px] truncate text-xs">{r.ticket.title}</div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        {r.ticket.unit && <span>{t.common.unit} {r.ticket.unit}</span>}
                        <StatusBadge status={r.ticket.status} />
                      </div>
                    </TD>
                    <TD className="text-xs">
                      <div className="font-medium">{r.reporterName}</div>
                      <div className="text-muted-foreground">{r.reporterType}</div>
                      <div className="text-muted-foreground" suppressHydrationWarning>{formatDateTime(r.createdAt, locale)}</div>
                    </TD>
                    <TD className="max-w-[280px] text-sm" dir="auto">
                      {r.reason}
                      {r.status !== "PENDING" && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.status === "CONFIRMED" ? t.fake.confirmed : t.fake.dismissed} · {r.resolvedByName}
                          {r.resolutionNote && <span dir="auto"> — {r.resolutionNote}</span>}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.status === "PENDING" && <ReviewButtons reportId={r.id} phone={r.phone} blocked={r.blocked} cancelled={r.ticketCancelled} />}
                        {r.blocked ? <UnblockButton phone={r.phone} /> : <BlockButton phone={r.phone} reason={`Fake ticket ${r.ticket.number}: ${r.reason}`} />}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{t.fake.blockedNumbers} <Badge variant="muted">{data.blocked.length}</Badge></CardTitle>
          <CardDescription>{t.fake.blockedHint}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.blocked.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t.fake.noBlocked}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t.fake.phone}</TH>
                  <TH>{t.fake.blockReason}</TH>
                  <TH />
                  <TH />
                </TR>
              </THead>
              <TBody>
                {data.blocked.map((b) => (
                  <TR key={b.id}>
                    <TD className="num font-medium" dir="ltr">{b.phone}</TD>
                    <TD className="max-w-[320px] text-sm" dir="auto">{b.reason}</TD>
                    <TD className="text-xs text-muted-foreground">
                      <div>{b.blockedByName} · <span suppressHydrationWarning>{formatDateTime(b.createdAt, locale)}</span></div>
                      {b.attempts > 0 && <div>{t.fake.attempts.replace("{n}", String(b.attempts))}</div>}
                    </TD>
                    <TD className="text-end"><UnblockButton phone={b.phone} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

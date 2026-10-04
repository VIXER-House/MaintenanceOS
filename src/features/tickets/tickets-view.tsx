"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Plus, Search, MessageCircle, Globe, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/domain/page-header";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { useI18n } from "@/lib/i18n/client";
import { relativeTime } from "@/lib/format";
import { PRIORITIES, TICKET_STATUSES } from "@/server/domain/constants";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/server/domain/labels";
import type { TicketFilters, TicketListResult } from "@/server/services/query.service";
import { cn } from "@/lib/utils";

const SOURCE_ICON = { WHATSAPP: MessageCircle, WEB: Globe, PHONE: Phone, DEMO: MessageCircle, SYSTEM: Globe } as const;

export function TicketsView({
  result,
  filters,
  categories,
  canCreate,
}: {
  result: TicketListResult;
  filters: TicketFilters;
  categories: { key: string; nameEn: string; nameAr: string }[];
  canCreate: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q ?? "");
  const [pending, start] = useTransition();

  function setParam(key: string, value: string | undefined) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    if (key !== "page") p.delete("page");
    start(() => router.push(`/tickets?${p.toString()}`));
  }

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [router]);

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const quick = [
    { label: t.common.all, status: undefined, sla: undefined },
    { label: t.common.open, status: "open", sla: undefined },
    { label: STATUS_LABELS.WAITING_APPROVAL[locale], status: "WAITING_APPROVAL", sla: undefined },
    { label: t.tickets.slaBreached, status: "open", sla: "breached" },
    { label: t.common.closed, status: "closed", sla: undefined },
  ];

  return (
    <div>
      <PageHeader
        title={t.tickets.title}
        subtitle={`${t.tickets.subtitle} · ${result.total}`}
        actions={canCreate && <Button asChild><Link href="/tickets/new"><Plus /> {t.tickets.new}</Link></Button>}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {quick.map((qk) => {
          const active = (filters.status ?? undefined) === qk.status && (filters.sla ?? undefined) === qk.sla;
          return (
            <button
              key={qk.label}
              onClick={() => {
                const p = new URLSearchParams();
                if (qk.status) p.set("status", qk.status);
                if (qk.sla) p.set("sla", qk.sla);
                start(() => router.push(`/tickets?${p.toString()}`));
              }}
              className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-primary text-white" : "bg-card hover:bg-muted")}
            >
              {qk.label}
            </button>
          );
        })}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <form
            className="relative min-w-[220px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam("q", q || undefined);
            }}
          >
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.tickets.searchPlaceholder} className="ps-8" />
          </form>
          <Select className="w-40" value={filters.status ?? ""} onChange={(e) => setParam("status", e.target.value || undefined)}>
            <option value="">{t.common.status}: {t.common.all}</option>
            <option value="open">{t.common.open}</option>
            <option value="closed">{t.common.closed}</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s][locale]}</option>)}
          </Select>
          <Select className="w-36" value={filters.priority ?? ""} onChange={(e) => setParam("priority", e.target.value || undefined)}>
            <option value="">{t.common.priority}: {t.common.all}</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p][locale]}</option>)}
          </Select>
          <Select className="w-40" value={filters.category ?? ""} onChange={(e) => setParam("category", e.target.value || undefined)}>
            <option value="">{t.common.category}: {t.common.all}</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{locale === "ar" ? c.nameAr : c.nameEn}</option>)}
          </Select>
        </div>
        <div className={cn("transition-opacity", pending && "opacity-60")}>
          <Table>
            <THead>
              <TR>
                <TH>{t.tickets.number}</TH>
                <TH>{t.detail.issue}</TH>
                <TH>{t.common.priority}</TH>
                <TH>{t.common.status}</TH>
                <TH>{t.tickets.sla}</TH>
                <TH>{t.common.assignee}</TH>
                <TH>{t.common.created}</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 && (
                <TR><TD colSpan={7} className="py-12 text-center text-muted-foreground">{t.tickets.empty}</TD></TR>
              )}
              {result.rows.map((r) => {
                const SrcIcon = SOURCE_ICON[r.source as keyof typeof SOURCE_ICON] ?? Globe;
                return (
                  <TR key={r.id} className="cursor-pointer" onClick={() => router.push(`/tickets/${r.id}`)}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/tickets/${r.id}`} className="num font-mono text-xs font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.ticketNumber}</Link>
                    </TD>
                    <TD className="max-w-[340px]">
                      <div className="flex items-center gap-2">
                        <CategoryIcon categoryKey={r.category?.key} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.title}</div>
                          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <SrcIcon className="h-3 w-3" />
                            {r.category ? (locale === "ar" ? r.category.nameAr : r.category.nameEn) : "—"}
                            {r.unit && ` · ${r.unit}`}
                            {r.resident && ` · ${locale === "ar" ? r.resident.nameAr ?? r.resident.name : r.resident.name}`}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD><PriorityBadge priority={r.priority} /></TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="whitespace-nowrap">{["CLOSED", "CANCELLED"].includes(r.status) ? <span className="text-xs text-muted-foreground">{r.sla.breached ? `✕ ${t.sla.MET_LATE}` : `✓ ${t.sla.MET}`}</span> : <SlaBadge sla={r.sla} compact />}</TD>
                    <TD className="whitespace-nowrap text-xs">{r.assignee ? (locale === "ar" ? r.assignee.nameAr ?? r.assignee.name : r.assignee.name) : <span className="text-muted-foreground">{t.common.unassigned}</span>}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground" suppressHydrationWarning>{relativeTime(r.createdAt, locale)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
            <span>{t.common.page} {result.page} {t.common.of} {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => setParam("page", String(result.page - 1))}>{t.common.prev}</Button>
              <Button variant="outline" size="sm" disabled={result.page >= pages} onClick={() => setParam("page", String(result.page + 1))}>{t.common.next}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

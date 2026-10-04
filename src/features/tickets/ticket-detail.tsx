"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Bot, Brain, Building2, CheckCircle2, ClipboardCheck, FileText, Hammer, History, MapPin, MessageCircle, Mic,
  Package, Pencil, Phone, Sparkles, User, Wrench, Image as ImageIcon, Clock, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { useI18n } from "@/lib/i18n/client";
import { formatDate, formatDateTime, formatMinutes, formatMoney, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TicketDetail } from "@/server/services/query.service";
import type { Role } from "@/server/domain/constants";
import { ActionBar, EditAnalysisDialog, QuotationReview, AssignDialog } from "./ticket-actions";
import { Timeline } from "./timeline";

export function TicketDetailView({
  ticket: t,
  role,
  categories,
  assets,
}: {
  ticket: TicketDetail;
  role: Role;
  categories: { key: string; nameEn: string; nameAr: string }[];
  assets: { id: string; assetCode: string; name: string }[];
}) {
  const { t: tr, locale } = useI18n();
  const router = useRouter();
  const isManagerRole = ["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"].includes(role);
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [router]);

  const analysis = t.analyses[0];
  const entities = (analysis?.entities ?? {}) as { issueAr?: string; severity?: string; assetType?: string; assetCode?: string; priorityDecision?: { source?: string; reasons?: string[] } };
  const name = <T extends { name: string; nameAr: string | null }>(x: T | null) => (x ? (locale === "ar" ? x.nameAr ?? x.name : x.name) : null);
  const activeQuote = t.quotations.find((q) => q.status === "SUBMITTED") ?? t.quotations[0];

  return (
    <div>
      <Link href={role === "TECHNICIAN" || role === "CONTRACTOR" ? "/my-jobs" : "/tickets"} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {tr.common.back}
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num font-mono text-sm font-semibold text-muted-foreground">{t.ticketNumber}</span>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.priorityOverridden && <Badge variant="muted"><Pencil className="h-3 w-3" /> manual</Badge>}
            <Badge variant="muted">{t.source === "WHATSAPP" ? <MessageCircle className="h-3 w-3" /> : <FileText className="h-3 w-3" />} {t.source}</Badge>
          </div>
          <h1 className="mt-1.5 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CategoryIcon categoryKey={t.category?.key} className="h-5 w-5" /> {t.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
            {formatDateTime(t.createdAt, locale)} · {relativeTime(t.createdAt, locale)}
            {t.unit && ` · ${tr.common.unit} ${t.unit.code}`}
          </p>
        </div>
        <ActionBar ticket={t} role={role} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Issue */}
          <Card>
            <CardHeader><CardTitle>{tr.detail.issue}</CardTitle></CardHeader>
            <CardContent>
              <blockquote className="whitespace-pre-line rounded-md border-s-4 border-emerald-500 bg-emerald-50/50 px-4 py-3 text-[15px]" dir="auto">{t.description}</blockquote>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Field icon={User} label={tr.common.resident} value={name(t.resident) ?? "—"} />
                <Field icon={Building2} label={tr.common.unit} value={t.unit ? `${t.unit.code} · ${t.unit.building}` : "—"} />
                <Field icon={MapPin} label={tr.common.location} value={t.location ?? "—"} />
                <Field icon={Package} label={tr.common.asset} value={t.asset ? <Link className="text-primary hover:underline" href={`/assets/${t.asset.id}`}>{t.asset.assetCode}</Link> : "—"} />
              </div>
            </CardContent>
          </Card>

          {/* AI analysis */}
          {analysis && (
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-start justify-between space-y-0 border-b bg-gradient-to-r from-violet-50/70 to-transparent pb-3">
                <div>
                  <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" /> {tr.detail.aiAnalysis}</CardTitle>
                  <CardDescription className="mt-1">
                    {tr.detail.provider}: {analysis.provider}{analysis.model ? ` · ${analysis.model}` : ""} · {analysis.latencyMs ?? 0}ms
                    {analysis.fallbackUsed && <span className="ms-1 text-orange-700">({tr.detail.fallback})</span>}
                    {analysis.edited && <span className="ms-1 text-violet-700">· {tr.detail.edited}</span>}
                  </CardDescription>
                </div>
                {isManagerRole && <EditAnalysisDialog ticket={t} categories={categories} assets={assets} />}
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <KV label={tr.common.category} value={<span className="flex items-center gap-1.5"><CategoryIcon categoryKey={t.category?.key} />{t.category ? (locale === "ar" ? t.category.nameAr : t.category.nameEn) : "—"}</span>} />
                  <KV label={tr.detail.issue} value={<span>{analysis.issue}{entities.issueAr && <span className="block text-xs text-muted-foreground" dir="rtl">{entities.issueAr}</span>}</span>} />
                  <KV label={tr.common.location} value={analysis.location ?? "—"} />
                  <KV
                    label={tr.common.priority}
                    value={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PriorityBadge priority={t.priority} />
                        {analysis.priority && analysis.priority !== t.priority && <span className="text-xs text-muted-foreground">({tr.detail.aiPriority}: {analysis.priority})</span>}
                      </span>
                    }
                  />
                  <KV label={tr.common.asset} value={t.asset ? `${t.asset.assetCode} · ${t.asset.name}` : entities.assetType ?? "—"} />
                  <KV
                    label={tr.detail.confidence}
                    value={
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 rounded-full bg-muted"><span className={cn("block h-1.5 rounded-full", analysis.confidence >= 0.75 ? "bg-emerald-600" : analysis.confidence >= 0.5 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${analysis.confidence * 100}%` }} /></span>
                        <span className="num font-semibold">{Math.round(analysis.confidence * 100)}%</span>
                      </span>
                    }
                  />
                  <KV label={tr.detail.recommended} value={<span className="font-medium text-violet-800">{analysis.recommendedAction ?? "—"}</span>} />
                  <KV label={tr.detail.severity} value={entities.severity ?? "—"} />
                  {analysis.followUpQuestion && <KV label={tr.detail.followUp} value={<span dir="auto">{analysis.followUpQuestion}</span>} />}
                </div>
                {analysis.reasoning && (
                  <div className="mt-4 rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
                    <div className="mb-1 flex items-center gap-1 font-semibold"><Brain className="h-3.5 w-3.5" /> {tr.detail.aiReasoning}</div>
                    {analysis.reasoning}
                  </div>
                )}
                {entities.priorityDecision?.reasons && (
                  <div className="mt-2 rounded-md border border-dashed p-3 text-xs">
                    <div className="mb-1 font-semibold">{tr.detail.priorityReasons} · {entities.priorityDecision.source}</div>
                    <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                      {entities.priorityDecision.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {t.analyses.length > 1 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">{t.analyses.length} analyses (initial + follow-up re-analysis)</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quotation */}
          {(t.quotations.length > 0 || t.requiresQuotation) && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4" /> {tr.detail.quotation}</CardTitle>
                {activeQuote && <Badge variant="outline" className={cn(activeQuote.status === "APPROVED" && "border-emerald-200 bg-emerald-50 text-emerald-700", activeQuote.status === "SUBMITTED" && "border-yellow-300 bg-yellow-50 text-yellow-800", activeQuote.status === "REJECTED" && "border-red-200 bg-red-50 text-red-700")}>{activeQuote.number} · {activeQuote.status}</Badge>}
              </CardHeader>
              <CardContent>
                {!activeQuote ? (
                  <p className="text-sm text-muted-foreground">{tr.detail.noQuotation}</p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                          <tr><th className="p-2 text-start">{tr.detail.description}</th><th className="p-2 text-start">{tr.detail.type}</th><th className="p-2 text-end">{tr.detail.qty}</th><th className="p-2 text-end">{tr.detail.unitPrice}</th><th className="p-2 text-end">{tr.common.total}</th></tr>
                        </thead>
                        <tbody>
                          {activeQuote.items.map((i) => (
                            <tr key={i.id} className="border-t">
                              <td className="p-2">{i.description}</td>
                              <td className="p-2 text-xs">{i.type === "LABOR" ? tr.detail.labor : tr.detail.materials}</td>
                              <td className="num p-2 text-end">{i.quantity}</td>
                              <td className="num p-2 text-end">{formatMoney(i.unitPrice, locale, false)}</td>
                              <td className="num p-2 text-end">{formatMoney(i.total, locale, false)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {activeQuote.notes && <p dir="auto">“{activeQuote.notes}”</p>}
                        <p>{activeQuote.createdByName} · {formatDateTime(activeQuote.createdAt, locale)}{activeQuote.estimatedHours ? ` · ${tr.detail.estHours}: ${activeQuote.estimatedHours}` : ""}</p>
                        {activeQuote.reviewedByName && <p>{activeQuote.status} — {activeQuote.reviewedByName} · {formatDateTime(activeQuote.reviewedAt, locale)}{activeQuote.reviewNotes ? ` · “${activeQuote.reviewNotes}”` : ""}</p>}
                      </div>
                      <dl className="num grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
                        <dt className="text-muted-foreground">{tr.detail.labor}</dt><dd className="text-end">{formatMoney(activeQuote.laborCost, locale)}</dd>
                        <dt className="text-muted-foreground">{tr.detail.materials}</dt><dd className="text-end">{formatMoney(activeQuote.materialsCost, locale)}</dd>
                        <dt className="text-muted-foreground">{tr.detail.vat} ({Math.round(activeQuote.vatRate * 100)}%)</dt><dd className="text-end">{formatMoney(activeQuote.vatAmount, locale)}</dd>
                        <dt className="font-semibold">{tr.common.total}</dt><dd className="text-end text-base font-semibold">{formatMoney(activeQuote.total, locale)}</dd>
                      </dl>
                    </div>
                    {activeQuote.status === "SUBMITTED" && isManagerRole && t.status === "WAITING_APPROVAL" && <QuotationReview ticket={t} quotationId={activeQuote.id} />}
                    {t.quotations.length > 1 && (
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        {t.quotations.map((q) => `${q.number} (${q.status})`).join(" · ")}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tabs */}
          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="timeline">
                <TabsList>
                  <TabsTrigger value="timeline"><History className="h-3.5 w-3.5" /> {tr.detail.timeline} <span className="num text-[10px] opacity-60">{t.events.length}</span></TabsTrigger>
                  <TabsTrigger value="comms"><MessageCircle className="h-3.5 w-3.5" /> {tr.detail.communication} <span className="num text-[10px] opacity-60">{t.messages.length}</span></TabsTrigger>
                  <TabsTrigger value="files"><ImageIcon className="h-3.5 w-3.5" /> {tr.detail.attachments} <span className="num text-[10px] opacity-60">{t.attachments.length}</span></TabsTrigger>
                  <TabsTrigger value="asset"><Package className="h-3.5 w-3.5" /> {tr.detail.assetHistory}</TabsTrigger>
                </TabsList>
                <TabsContent value="timeline"><Timeline events={t.events} /></TabsContent>
                <TabsContent value="comms">
                  <div className="wa-pattern max-h-[480px] space-y-2 overflow-y-auto rounded-lg p-4">
                    {t.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">{tr.common.noResults}</p>}
                    {t.messages.map((m) => (
                      <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm", m.direction === "OUTBOUND" ? "bg-wa-out" : "bg-white")} dir="auto">
                          {m.mediaType === "AUDIO" && <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Mic className="h-3 w-3" /> voice note</div>}
                          {m.mediaType === "IMAGE" && m.mediaUrl && <img src={m.mediaUrl} alt="" className="mb-1 max-h-40 rounded" />}
                          {m.body && <div className="whitespace-pre-line">{m.body}</div>}
                          {m.transcript && <div className="mt-1 border-t pt-1 text-xs italic text-muted-foreground">“{m.transcript}”</div>}
                          <div className="mt-0.5 text-end text-[10px] text-muted-foreground">{m.senderName} · {formatDateTime(m.createdAt, locale)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="files">
                  {t.attachments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{tr.common.noResults}</p> : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {t.attachments.map((a) => (
                        <div key={a.id} className="rounded-md border p-3 text-sm">
                          {a.type === "IMAGE" ? <img src={a.url} alt={a.fileName} className="mb-2 max-h-48 w-full rounded object-cover" /> : a.type === "AUDIO" ? <audio controls src={a.url} className="mb-2 w-full" /> : null}
                          <div className="truncate text-xs font-medium">{a.fileName}</div>
                          {a.analysis && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {"transcript" in a.analysis ? <>🎙️ “{String(a.analysis.transcript)}”</> : <>🔍 {String(a.analysis.issue ?? "")} · {Math.round(Number(a.analysis.confidence ?? 0) * 100)}% · {String(a.analysis.categoryKey ?? "")}</>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="asset">
                  {!t.asset ? <p className="py-6 text-center text-sm text-muted-foreground">{tr.detail.noAsset}</p> : (
                    <div>
                      <div className="mb-3 text-sm"><span className="font-mono font-semibold">{t.asset.assetCode}</span> · {locale === "ar" ? t.asset.nameAr ?? t.asset.name : t.asset.name} · {t.asset.location}</div>
                      <ol className="relative space-y-3 border-s ps-5">
                        {t.asset.history.map((h) => (
                          <li key={h.id} className="relative">
                            <span className={cn("absolute -start-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white", h.ticketId === t.id ? "bg-primary" : "bg-slate-300")} />
                            <div className="text-xs text-muted-foreground">{formatDate(h.date, locale)} · {h.type}</div>
                            <div className="text-sm">{h.description}{h.ticketId === t.id && <Badge className="ms-2">this ticket</Badge>}</div>
                            <div className="text-xs text-muted-foreground">{h.performedBy}{h.cost !== null ? ` · ${formatMoney(h.cost, locale)}` : ""}</div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> SLA</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SlaRow label={tr.sla.response} state={t.sla.responseState} due={t.sla.responseDueAt} took={t.sla.timeToAcknowledgeMs} tookLabel={tr.sla.timeToAck} />
              <SlaRow label={tr.sla.resolution} state={t.sla.resolutionState} due={t.sla.resolutionDueAt} took={t.sla.timeToResolutionMs} tookLabel={tr.sla.timeToResolve} />
              {!["CLOSED", "CANCELLED", "COMPLETED"].includes(t.status) && <div className="border-t pt-3"><SlaBadge sla={t.sla} /></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-1.5"><Wrench className="h-4 w-4" /> {tr.detail.assignment}</CardTitle>
              {isManagerRole && t.actions.includes("assign") && <AssignDialog ticket={t} />}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {t.technician || t.contractor ? (
                <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">{t.technician ? <Hammer className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{name(t.technician ?? t.contractor)}</div>
                    <div className="text-xs text-muted-foreground">{t.technician ? tr.detail.technician : tr.detail.contractor}{t.team ? ` · ${locale === "ar" ? t.team.nameAr ?? t.team.name : t.team.name}` : ""}</div>
                  </div>
                  <a href={`tel:${(t.technician ?? t.contractor)!.phone}`} className="rounded p-1.5 hover:bg-muted"><Phone className="h-4 w-4" /></a>
                </div>
              ) : (
                <p className="text-muted-foreground">{tr.common.unassigned}</p>
              )}
              {t.suggestedContractor && !t.contractor && isManagerRole && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-1 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> {tr.detail.suggestedContractor}</div>
                  <div className="mt-1 font-medium">{name(t.suggestedContractor)}</div>
                  <AssignDialog ticket={t} preset={{ contractorId: t.suggestedContractor.id }} label={tr.detail.confirmContractor} />
                </div>
              )}
              {t.recommendation && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Bot className="h-3.5 w-3.5" /> {tr.detail.recommendations}</div>
                  <div className="space-y-1">
                    {t.recommendation.technicians.slice(0, 4).map((r) => (
                      <div key={r.id} className={cn("flex items-center gap-2 text-xs", !r.eligible && "opacity-50")}>
                        <span className="w-28 truncate">{r.name}</span>
                        <span className="h-1.5 flex-1 rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${r.score}%` }} /></span>
                        <span className="num w-8 text-end font-medium">{r.score}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">score = skill×50 + availability×30 + (1−workload)×20</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{tr.detail.costs}</CardTitle></CardHeader>
            <CardContent className="num grid grid-cols-3 gap-2 text-center text-sm">
              <CostCell label={tr.detail.estimated} value={formatMoney(t.estimatedCost, locale)} />
              <CostCell label={tr.detail.approved} value={formatMoney(t.approvedCost, locale)} />
              <CostCell label={tr.detail.final} value={formatMoney(t.finalCost, locale)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{tr.detail.lifecycle}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              {[
                [tr.common.created, t.createdAt],
                [tr.actions.assign, t.assignedAt],
                [tr.actions.acknowledge, t.acknowledgedAt],
                [tr.actions.start, t.startedAt],
                [tr.actions.complete, t.completedAt],
                [tr.detail.residentConfirmed, t.residentConfirmedAt],
                [tr.actions.close, t.closedAt],
              ].map(([label, at]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className={cn("flex items-center gap-1.5", at ? "text-foreground" : "text-muted-foreground")}>
                    {at ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border" />} {label}
                  </span>
                  <span className="num text-muted-foreground">{at ? formatDateTime(at as string, locale) : "—"}</span>
                </div>
              ))}
              {t.resolutionNotes && <p className="mt-2 rounded bg-muted/60 p-2" dir="auto">{t.resolutionNotes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function CostCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xs", strong && "font-semibold")}>{value}</div>
    </div>
  );
}

function SlaRow({ label, state, due, took, tookLabel }: { label: string; state: string; due: string | null; took: number | null; tookLabel: string }) {
  const { t, locale } = useI18n();
  const color = state === "BREACHED" || state === "MET_LATE" ? "text-red-700" : state === "AT_RISK" ? "text-orange-700" : state === "MET" ? "text-emerald-700" : "text-slate-700";
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{t.sla.due}: {formatDateTime(due, locale)}</div>
        {took !== null && <div className="text-xs text-muted-foreground">{tookLabel}: {formatMinutes(took / 60000, locale)}</div>}
      </div>
      <span className={cn("text-xs font-semibold", color)}>{t.sla[state as keyof typeof t.sla] ?? state}</span>
    </div>
  );
}

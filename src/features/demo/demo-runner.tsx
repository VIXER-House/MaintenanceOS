"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2, Package, Play, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/domain/page-header";
import { PriorityBadge, StatusBadge } from "@/components/domain/badges";
import { toast } from "@/components/ui/toaster";
import { Timeline } from "@/features/tickets/timeline";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/api-client";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DemoSnapshot } from "@/server/services/demo.service";

const STEPS = ["resident_message", "technician_acknowledge", "technician_quotation", "manager_approve", "technician_complete", "resident_confirm", "manager_close"] as const;
type Step = (typeof STEPS)[number];

export function DemoRunner() {
  const { t, locale } = useI18n();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [done, setDone] = useState<Step[]>([]);
  const [running, setRunning] = useState<Step | null>(null);
  const [snap, setSnap] = useState<DemoSnapshot | null>(null);
  const [logs, setLogs] = useState<{ step: Step; log: string }[]>([]);
  const stopRef = useRef(false);

  const next = STEPS.find((s) => !done.includes(s)) ?? null;
  const finished = done.length === STEPS.length;

  async function runStep(step: Step, id: string | null): Promise<string | null> {
    setRunning(step);
    try {
      const r = await api<{ ticketId: string; log: string; snapshot: DemoSnapshot }>("/api/demo/step", { body: { step, ticketId: id } });
      setTicketId(r.ticketId);
      setSnap(r.snapshot);
      setDone((d) => [...d, step]);
      setLogs((l) => [...l, { step, log: r.log }]);
      return r.ticketId;
    } catch (e) {
      toast.error((e as Error).message);
      stopRef.current = true;
      return null;
    } finally {
      setRunning(null);
    }
  }

  function reset() {
    setTicketId(null);
    setDone([]);
    setSnap(null);
    setLogs([]);
  }

  async function autoPlay() {
    reset();
    stopRef.current = false;
    let id: string | null = null;
    for (const s of STEPS) {
      if (stopRef.current) break;
      id = await runStep(s, id);
      if (!id) break;
      await new Promise((r) => setTimeout(r, 1600));
    }
  }

  return (
    <div>
      <PageHeader
        title={t.demo.title}
        subtitle={t.demo.subtitle}
        actions={
          <>
            <Button variant="outline" disabled={!!running || finished} onClick={() => next && runStep(next, ticketId)}>
              {running ? <Loader2 className="animate-spin" /> : <SkipForward className="rtl:-scale-x-100" />} {t.demo.nextStep}
            </Button>
            <Button disabled={!!running} onClick={autoPlay}>
              {done.length ? <RotateCcw /> : <Play />} {done.length ? t.demo.restart : t.demo.start}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><CardTitle>{t.demo.stepByStep}</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const isDone = done.includes(s);
                const isRunning = running === s;
                const log = logs.find((l) => l.step === s)?.log;
                return (
                  <li key={s} className={cn("rounded-md p-2.5", isRunning && "bg-accent", isDone && "bg-emerald-50/60")}>
                    <div className="flex items-start gap-2.5">
                      {isRunning ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" /> : isDone ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{i + 1}. {t.demo.steps[s]}</div>
                        {s === "resident_message" && <div className="text-[11px] text-muted-foreground">{t.demo.substeps}</div>}
                        {log && <div className="mt-1 text-xs text-muted-foreground" dir="auto">{log}</div>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {finished && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {t.demo.done}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t.demo.events}</CardTitle>
              <CardDescription>TicketEvent · PostgreSQL</CardDescription>
            </div>
            {snap && (
              <div className="flex items-center gap-2">
                <StatusBadge status={snap.ticket.status} />
                <Link href={`/tickets/${snap.ticket.id}`} className="text-xs text-primary hover:underline"><ExternalLink className="inline h-3 w-3" /> {snap.ticket.ticketNumber}</Link>
              </div>
            )}
          </CardHeader>
          <CardContent className="max-h-[640px] overflow-y-auto">
            {!snap ? (
              <div className="grid place-items-center py-24 text-center text-sm text-muted-foreground">
                <Sparkles className="mb-2 h-6 w-6 text-violet-500" />
                {t.demo.start} →
              </div>
            ) : (
              <Timeline events={snap.events} newestFirst />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[28px] border-[6px] border-slate-900 bg-slate-900 shadow-xl">
            <div className="bg-wa-header px-4 py-2.5 text-white">
              <div className="text-sm font-medium">MaintenanceOS</div>
              <div className="text-[11px] opacity-80">{t.demo.residentPhone} · A01-201</div>
            </div>
            <div className="wa-pattern h-[380px] space-y-1.5 overflow-y-auto p-3">
              {snap?.messages.map((m) => (
                <div key={m.id} className={cn("flex animate-fade-in", m.direction === "INBOUND" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12.5px] shadow-sm", m.direction === "INBOUND" ? "bg-wa-out" : "bg-white")} dir="auto">
                    <div className="whitespace-pre-line">{m.body}</div>
                    <div className="mt-0.5 text-end text-[9px] text-muted-foreground">{formatTime(m.createdAt, locale)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {snap && (
            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num font-mono font-semibold">{snap.ticket.ticketNumber}</span>
                  <PriorityBadge priority={snap.ticket.priority} />
                  <Badge variant="muted">{snap.ticket.category}</Badge>
                </div>
                <div className="font-medium">{snap.ticket.title}</div>
                {snap.ticket.analysis && (
                  <div className="text-xs text-muted-foreground">
                    AI ({snap.ticket.analysis.provider}): {snap.ticket.analysis.issue} · {snap.ticket.analysis.location ?? "—"} · {Math.round(snap.ticket.analysis.confidence * 100)}%
                  </div>
                )}
                <div className="text-xs">{t.common.assignee}: <span className="font-medium">{snap.ticket.assignee ?? "—"}</span></div>
                {snap.ticket.quotation && (
                  <div className="text-xs">{t.detail.quotation}: {snap.ticket.quotation.number} · {formatMoney(snap.ticket.quotation.total, locale)} · <span className="font-medium">{snap.ticket.quotation.status}</span></div>
                )}
                {snap.ticket.finalCost !== null && <div className="text-xs">{t.detail.final}: {formatMoney(snap.ticket.finalCost, locale)}</div>}
                {snap.ticket.asset && (
                  <div className="rounded-md border p-2">
                    <div className="mb-1 flex items-center gap-1 text-xs font-semibold"><Package className="h-3.5 w-3.5" /> {snap.ticket.asset.assetCode} · {t.detail.assetHistory}</div>
                    {snap.ticket.asset.history.slice(0, 3).map((h, i) => (
                      <div key={i} className={cn("text-[11px]", i === 0 && finished ? "font-medium text-emerald-700" : "text-muted-foreground")}>
                        {formatDate(h.date, locale)} · {h.description}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

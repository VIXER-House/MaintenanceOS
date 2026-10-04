"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Flame, CircleDot, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/server/domain/labels";
import type { Priority, TicketStatus } from "@/server/domain/constants";

const PRIORITY_STYLE: Record<Priority, string> = {
  EMERGENCY: "bg-red-600 text-white border-red-600",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-800 border-amber-200",
  LOW: "bg-slate-50 text-slate-600 border-slate-200",
};

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const { locale } = useI18n();
  return (
    <Badge variant="outline" className={cn(PRIORITY_STYLE[priority], className)}>
      {priority === "EMERGENCY" ? <Flame className="h-3 w-3" /> : <span className={cn("h-1.5 w-1.5 rounded-full", priority === "CRITICAL" ? "bg-red-600" : priority === "HIGH" ? "bg-orange-500" : priority === "MEDIUM" ? "bg-amber-500" : "bg-slate-400")} />}
      {PRIORITY_LABELS[priority][locale]}
    </Badge>
  );
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  NEW: "bg-sky-50 text-sky-700 border-sky-200",
  AI_ANALYZING: "bg-violet-50 text-violet-700 border-violet-200",
  WAITING_FOR_INFO: "bg-amber-50 text-amber-800 border-amber-200",
  ASSIGNED: "bg-blue-50 text-blue-700 border-blue-200",
  ACKNOWLEDGED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  IN_PROGRESS: "bg-teal-50 text-teal-700 border-teal-200",
  WAITING_QUOTATION: "bg-yellow-50 text-yellow-800 border-yellow-200",
  WAITING_APPROVAL: "bg-yellow-50 text-yellow-800 border-yellow-300",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-slate-50 text-slate-400 border-slate-200 line-through",
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const { locale } = useI18n();
  return (
    <Badge variant="outline" className={cn(STATUS_STYLE[status], className)}>
      {STATUS_LABELS[status][locale]}
    </Badge>
  );
}

export interface SlaLike {
  overall: string;
  breached: boolean;
  responseState: string;
  resolutionState: string;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
}

/** Live SLA countdown (re-renders every 30s). */
export function SlaBadge({ sla, compact = false }: { sla: SlaLike; compact?: boolean }) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Pick the clock that is still running: response until acknowledged, then resolution
  const responseRunning = !["MET", "MET_LATE", "NONE"].includes(sla.responseState);
  const resolutionRunning = !["MET", "MET_LATE", "NONE"].includes(sla.resolutionState);
  const due = responseRunning ? sla.responseDueAt : resolutionRunning ? sla.resolutionDueAt : null;

  if (!due) {
    const late = sla.resolutionState === "MET_LATE" || sla.responseState === "MET_LATE" || sla.breached;
    if (sla.resolutionState === "NONE" && sla.responseState === "NONE") return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", late ? "text-red-700" : "text-emerald-700")}>
        {late ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        {late ? t.sla.MET_LATE : t.sla.MET}
      </span>
    );
  }
  const remainingMin = (new Date(due).getTime() - now) / 60_000;
  const overdue = remainingMin < 0;
  const atRisk = !overdue && sla.overall === "AT_RISK";
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 text-xs font-medium",
        overdue ? "text-red-700" : atRisk ? "text-orange-700" : "text-slate-700",
      )}
      title={`${responseRunning ? t.sla.response : t.sla.resolution} · ${t.sla.due} ${formatDateTime(due, locale)}`}
      suppressHydrationWarning
    >
      {overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {overdue
        ? `${formatMinutes(-remainingMin, locale)} ${t.sla.overdue}`
        : `${formatMinutes(remainingMin, locale)} ${t.sla.remaining}`}
      {!compact && <span className="font-normal text-muted-foreground">· {responseRunning ? t.sla.response : t.sla.resolution}</span>}
    </span>
  );
}

export function SourceIcon({ source }: { source: string }) {
  return <CircleDot className={cn("h-3 w-3", source === "WHATSAPP" ? "text-emerald-600" : "text-slate-400")} />;
}

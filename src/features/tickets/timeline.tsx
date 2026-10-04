"use client";

import {
  AlertTriangle, Bot, Check, CheckCheck, ClipboardCheck, ClipboardList, Clock, FileEdit, Flag, Lock, MessageCircle, Package,
  PencilLine, Play, PlusCircle, RotateCcw, ShieldCheck, Sparkles, StickyNote, ThumbsUp, UserCheck, UserPlus, X, Ban, HelpCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<string, [React.ElementType, string]> = {
  TICKET_CREATED: [PlusCircle, "bg-sky-100 text-sky-700"],
  AI_ANALYZING: [Bot, "bg-violet-100 text-violet-700"],
  AI_ANALYZED: [Sparkles, "bg-violet-100 text-violet-700"],
  AI_ANALYSIS_EDITED: [PencilLine, "bg-violet-100 text-violet-700"],
  INFO_REQUESTED: [HelpCircle, "bg-amber-100 text-amber-700"],
  INFO_RECEIVED: [MessageCircle, "bg-emerald-100 text-emerald-700"],
  PRIORITY_CHANGED: [Flag, "bg-orange-100 text-orange-700"],
  CATEGORY_CHANGED: [PencilLine, "bg-slate-100 text-slate-700"],
  SLA_SET: [Clock, "bg-slate-100 text-slate-700"],
  SLA_BREACHED: [AlertTriangle, "bg-red-100 text-red-700"],
  ASSIGNED: [UserPlus, "bg-blue-100 text-blue-700"],
  REASSIGNED: [UserPlus, "bg-blue-100 text-blue-700"],
  ACKNOWLEDGED: [UserCheck, "bg-indigo-100 text-indigo-700"],
  STARTED: [Play, "bg-teal-100 text-teal-700"],
  QUOTATION_REQUESTED: [ClipboardList, "bg-yellow-100 text-yellow-800"],
  QUOTATION_CREATED: [ClipboardList, "bg-yellow-100 text-yellow-800"],
  QUOTATION_APPROVED: [ClipboardCheck, "bg-emerald-100 text-emerald-700"],
  QUOTATION_REJECTED: [X, "bg-red-100 text-red-700"],
  QUOTATION_REVISION_REQUESTED: [FileEdit, "bg-yellow-100 text-yellow-800"],
  COMPLETED: [CheckCheck, "bg-emerald-100 text-emerald-700"],
  RESIDENT_CONFIRMED: [ThumbsUp, "bg-emerald-100 text-emerald-700"],
  RESIDENT_DISPUTED: [AlertTriangle, "bg-red-100 text-red-700"],
  CLOSED: [Lock, "bg-slate-200 text-slate-700"],
  CANCELLED: [Ban, "bg-slate-100 text-slate-500"],
  REOPENED: [RotateCcw, "bg-orange-100 text-orange-700"],
  ASSET_HISTORY_UPDATED: [Package, "bg-teal-100 text-teal-700"],
  NOTE_ADDED: [StickyNote, "bg-slate-100 text-slate-700"],
  STATUS_CHANGED: [Check, "bg-slate-100 text-slate-600"],
  MESSAGE_SENT: [MessageCircle, "bg-emerald-100 text-emerald-700"],
  MESSAGE_RECEIVED: [MessageCircle, "bg-emerald-100 text-emerald-700"],
  ATTACHMENT_ADDED: [ShieldCheck, "bg-slate-100 text-slate-700"],
};

export interface TimelineEvent {
  id: string;
  type: string;
  actorType?: string;
  actorName: string | null;
  message: string;
  createdAt: string;
}

export function Timeline({ events, newestFirst = false }: { events: TimelineEvent[]; newestFirst?: boolean }) {
  const { locale } = useI18n();
  const list = newestFirst ? [...events].reverse() : events;
  return (
    <ol className="relative space-y-0">
      {list.map((e, i) => {
        const [Icon, color] = ICON[e.type] ?? [Check, "bg-slate-100 text-slate-600"];
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 animate-fade-in">
            {i < list.length - 1 && <span className="absolute start-[13px] top-7 h-[calc(100%-20px)] w-px bg-border" />}
            <span className={cn("z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full", color)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm" dir="auto">{e.message}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{e.type}</span> · {e.actorName ?? "—"} · {formatDateTime(e.createdAt, locale)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

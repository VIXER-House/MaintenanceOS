"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, ClipboardList, Loader2, Lock, Pencil, Play, Plus, RotateCcw, Trash2, UserPlus, X, Ban, Flag, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { PRIORITIES, DEFAULT_VAT_RATE, type Role } from "@/server/domain/constants";
import { PRIORITY_LABELS } from "@/server/domain/labels";
import type { TicketDetail } from "@/server/services/query.service";

function useAction(ticketId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(action: string, body: Record<string, unknown> = {}, success?: string) {
    setBusy(action);
    try {
      await api(`/api/tickets/${ticketId}/${action}`, { body });
      toast.success(success ?? "✓");
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}

export function ActionBar({ ticket, role }: { ticket: TicketDetail; role: Role }) {
  const { t } = useI18n();
  const { run, busy } = useAction(ticket.id);
  const a = ticket.actions;
  const spin = (k: string) => (busy === k ? <Loader2 className="animate-spin" /> : null);
  void role;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {a.includes("acknowledge") && (
        <Button onClick={() => run("acknowledge", {}, t.actions.acknowledge)} disabled={!!busy}>
          {spin("acknowledge") ?? <Check />} {t.actions.acknowledge}
        </Button>
      )}
      {a.includes("decline") && <DeclineDialog ticketId={ticket.id} />}
      {a.includes("start") && (
        <Button variant={a.includes("acknowledge") ? "outline" : "default"} onClick={() => run("start", {}, t.actions.start)} disabled={!!busy}>
          {spin("start") ?? <Play />} {t.actions.start}
        </Button>
      )}
      {a.includes("requestQuotation") && !ticket.isAssignee && ticket.status !== "WAITING_QUOTATION" && (
        <Button variant="outline" onClick={() => run("request-quotation", {}, t.actions.requestQuotation)} disabled={!!busy}>
          {spin("request-quotation") ?? <ClipboardList />} {t.actions.requestQuotation}
        </Button>
      )}
      {a.includes("submitQuotation") && ticket.status !== "WAITING_APPROVAL" && <QuotationDialog ticket={ticket} />}
      {a.includes("complete") && <CompleteDialog ticket={ticket} />}
      {a.includes("close") && <NotesDialog ticket={ticket} action="close" icon={Lock} label={t.actions.close} variant="default" />}
      {a.includes("reopen") && <NotesDialog ticket={ticket} action="reopen" icon={RotateCcw} label={t.actions.reopen} variant="outline" />}
      {a.includes("changePriority") && <PriorityDialog ticket={ticket} />}
      {a.includes("cancel") && <NotesDialog ticket={ticket} action="cancel" icon={Ban} label={t.actions.cancel} variant="ghost" />}
    </div>
  );
}

export function NotesDialog({
  ticket,
  action,
  label,
  icon: Icon,
  variant = "outline",
  quotationId,
}: {
  ticket: TicketDetail;
  action: string;
  label: string;
  icon: React.ElementType;
  variant?: "default" | "outline" | "ghost" | "destructive" | "success";
  quotationId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const { run, busy } = useAction(ticket.id);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}><Icon /> {label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} · {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>{ticket.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t.detail.reason}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            variant={variant === "ghost" ? "destructive" : variant === "outline" ? "default" : variant}
            disabled={!!busy}
            onClick={async () => {
              if (await run(action, { notes: notes || null, ...(quotationId ? { quotationId } : {}) }, label)) setOpen(false);
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ ticket }: { ticket: TicketDetail }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<string>(ticket.priority);
  const [reason, setReason] = useState("");
  const { run, busy } = useAction(ticket.id);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Flag /> {t.actions.changePriority}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.actions.changePriority}</DialogTitle>
          <DialogDescription>
            {t.detail.aiPriority}: {ticket.aiSuggestedPriority ?? "—"} · {t.detail.finalPriority}: {ticket.priority}. SLA will be recalculated.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-5 gap-1.5">
          {PRIORITIES.map((p) => (
            <button key={p} onClick={() => setPriority(p)} className={`rounded-md border px-2 py-2 text-xs ${priority === p ? "border-primary bg-primary text-white" : "hover:bg-muted"}`}>
              {PRIORITY_LABELS[p][locale]}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label>{t.detail.reason}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={!!busy || priority === ticket.priority} onClick={async () => (await run("priority", { priority, reason: reason || null }, t.actions.changePriority)) && setOpen(false)}>
            {busy && <Loader2 className="animate-spin" />} {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ ticket }: { ticket: TicketDetail }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [finalCost, setFinalCost] = useState<string>(String(ticket.approvedCost ?? ticket.estimatedCost ?? ""));
  const { run, busy } = useAction(ticket.id);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="success"><CheckCheck /> {t.actions.complete}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.actions.complete} · {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>{ticket.asset ? `${t.detail.assetHistory}: ${ticket.asset.assetCode}` : t.detail.noAsset}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t.detail.completionNotes}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Replaced the faulty part and tested." />
        </div>
        <div className="space-y-1.5">
          <Label>{t.detail.finalCost}</Label>
          <Input type="number" min={0} value={finalCost} onChange={(e) => setFinalCost(e.target.value)} />
          {ticket.approvedCost !== null && <p className="text-xs text-muted-foreground">{t.detail.approved}: {formatMoney(ticket.approvedCost, locale)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button variant="success" disabled={!!busy} onClick={async () => (await run("complete", { notes: notes || null, finalCost: finalCost === "" ? null : Number(finalCost) }, t.actions.complete)) && setOpen(false)}>
            {busy && <Loader2 className="animate-spin" />} {t.actions.complete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Line = { type: "LABOR" | "MATERIAL"; description: string; quantity: string; unitPrice: string };

export function QuotationDialog({ ticket }: { ticket: TicketDetail }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { type: "LABOR", description: "Labor", quantity: "2", unitPrice: "300" },
    { type: "MATERIAL", description: "", quantity: "1", unitPrice: "" },
  ]);
  const [hours, setHours] = useState("4");
  const [notes, setNotes] = useState("");
  const { run, busy } = useAction(ticket.id);
  const valid = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");
  const labor = valid.filter((l) => l.type === "LABOR").reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
  const materials = valid.filter((l) => l.type === "MATERIAL").reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
  const vat = Math.round((labor + materials) * DEFAULT_VAT_RATE * 100) / 100;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (i === j ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><ClipboardList /> {t.actions.submitQuotation}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.detail.quotation} · {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>{t.detail.approvalLimitNote}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr_70px_100px_32px] items-center gap-2">
              <Select value={l.type} onChange={(e) => set(i, { type: e.target.value as Line["type"] })}>
                <option value="LABOR">{t.detail.labor}</option>
                <option value="MATERIAL">{t.detail.materials}</option>
              </Select>
              <Input placeholder={t.detail.description} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
              <Input type="number" min={0} step="0.5" placeholder={t.detail.qty} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              <Input type="number" min={0} placeholder={t.detail.unitPrice} value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
              <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { type: "MATERIAL", description: "", quantity: "1", unitPrice: "" }])}><Plus /> {t.detail.addItem}</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <div className="space-y-1.5">
            <Label>{t.detail.estHours}</Label>
            <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.common.notes}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="الكمبروسر محتاج تغيير" dir="auto" />
          </div>
        </div>
        <div className="num flex flex-wrap justify-end gap-x-5 gap-y-1 rounded-md bg-muted/60 p-3 text-sm">
          <span>{t.detail.labor}: {formatMoney(labor, locale)}</span>
          <span>{t.detail.materials}: {formatMoney(materials, locale)}</span>
          <span>{t.detail.vat} 14%: {formatMoney(vat, locale)}</span>
          <span className="font-semibold">{t.common.total}: {formatMoney(labor + materials + vat, locale)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={!!busy || valid.length === 0}
            onClick={async () => {
              const ok = await run(
                "quotation",
                {
                  items: valid.map((l) => ({ type: l.type, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
                  estimatedHours: hours ? Number(hours) : null,
                  notes: notes || null,
                },
                t.detail.submitQuotation,
              );
              if (ok) setOpen(false);
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {t.detail.submitQuotation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuotationReview({ ticket, quotationId }: { ticket: TicketDetail; quotationId: string }) {
  const { t } = useI18n();
  const { run, busy } = useAction(ticket.id);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3">
      <p className="text-xs text-yellow-900">{t.detail.approvalLimitNote}</p>
      <div className="flex flex-wrap gap-2">
        <NotesDialog ticket={ticket} action="revision" icon={FileEdit} label={t.actions.requestRevision} variant="outline" quotationId={quotationId} />
        <NotesDialog ticket={ticket} action="reject" icon={X} label={t.actions.reject} variant="destructive" quotationId={quotationId} />
        <Button variant="success" disabled={!!busy} onClick={() => run("approve", { quotationId }, t.actions.approve)}>
          {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} {t.actions.approve}
        </Button>
      </div>
    </div>
  );
}

function DeclineDialog({ ticketId }: { ticketId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy } = useAction(ticketId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-red-700"><Ban /> {t.actions.decline}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.actions.declineTitle}</DialogTitle>
          <DialogDescription>{t.actions.declineHint}</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.actions.declineReason} dir="auto" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={!!busy || reason.trim().length < 3} onClick={async () => (await run("decline", { reason }, t.actions.declined)) && setOpen(false)}>
            {busy && <Loader2 className="animate-spin" />} {t.actions.decline}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignDialog({ ticket, preset, label }: { ticket: TicketDetail; preset?: { technicianId?: string; contractorId?: string }; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<{ technicianId?: string; contractorId?: string }>(preset ?? {});
  const { run, busy } = useAction(ticket.id);
  const rec = ticket.recommendation;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {preset ? <Button size="sm" className="mt-2">{label}</Button> : <Button variant="outline" size="sm"><UserPlus /> {t.actions.assign}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.actions.assign} · {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>{rec?.reason}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t.detail.technician}</div>
            <div className="space-y-1">
              {rec?.technicians.map((r) => (
                <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm ${choice.technicianId === r.id ? "border-primary bg-accent" : ""} ${!r.eligible ? "opacity-60" : ""}`}>
                  <input type="radio" name="assignee" checked={choice.technicianId === r.id} onChange={() => setChoice({ technicianId: r.id })} />
                  <span className="flex-1">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.reasons.join(" · ")}</span>
                  </span>
                  <span className="num text-xs font-semibold">{r.score}</span>
                </label>
              ))}
            </div>
          </div>
          {rec && rec.contractors.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t.detail.contractor}</div>
              <div className="space-y-1">
                {rec.contractors.map((c) => (
                  <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm ${choice.contractorId === c.id ? "border-primary bg-accent" : ""}`}>
                    <input type="radio" name="assignee" checked={choice.contractorId === c.id} onChange={() => setChoice({ contractorId: c.id })} />
                    <span className="flex-1">
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{c.reasons.join(" · ")}</span>
                    </span>
                    <span className="num text-xs font-semibold">{c.score}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={!!busy || (!choice.technicianId && !choice.contractorId)}
            onClick={async () => {
              const pick = rec?.technicians.find((r) => r.id === choice.technicianId);
              if (pick && !pick.eligible && !window.confirm(t.actions.unavailableConfirm.replace("{name}", pick.name).replace("{why}", pick.reasons.join(" · ")))) return;
              if (await run("assign", choice, t.actions.assign)) setOpen(false);
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {t.actions.assign}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditAnalysisDialog({
  ticket,
  categories,
  assets,
}: {
  ticket: TicketDetail;
  categories: { key: string; nameEn: string; nameAr: string }[];
  assets: { id: string; assetCode: string; name: string }[];
}) {
  const { t, locale } = useI18n();
  const a = ticket.analyses[0];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    categoryKey: ticket.category?.key ?? "OTHER",
    priority: ticket.priority as string,
    title: ticket.title,
    location: ticket.location ?? "",
    assetId: ticket.asset?.id ?? "",
    recommendedAction: a?.recommendedAction ?? "",
  });
  const { run, busy } = useAction(ticket.id);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Pencil /> {t.detail.editAnalysis}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.detail.editAnalysis}</DialogTitle>
          <DialogDescription>Human-in-the-loop: your corrections override the AI and are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t.detail.issue}</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.common.category}</Label>
            <Select value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })}>
              {categories.map((c) => <option key={c.key} value={c.key}>{locale === "ar" ? c.nameAr : c.nameEn}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t.common.priority}</Label>
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p][locale]}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t.common.location}</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.common.asset}</Label>
            <Select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
              <option value="">—</option>
              {assets.map((x) => <option key={x.id} value={x.id}>{x.assetCode} · {x.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t.detail.recommended}</Label>
            <Input value={form.recommendedAction} onChange={(e) => setForm({ ...form, recommendedAction: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={!!busy}
            onClick={async () => {
              const ok = await run(
                "analysis",
                {
                  categoryKey: form.categoryKey,
                  priority: form.priority,
                  title: form.title,
                  location: form.location || null,
                  assetId: form.assetId || null,
                  recommendedAction: form.recommendedAction || null,
                },
                t.common.save,
              );
              if (ok) setOpen(false);
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

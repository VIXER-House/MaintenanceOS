"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Check, CheckCheck, ExternalLink, ImagePlus, Loader2, Mic, Paperclip, Search, Send, Sparkles, Phone, Video, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { api, fileToBase64 } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Priority, TicketStatus } from "@/server/domain/constants";
import type { SlaDTO } from "@/server/services/query.service";

interface ResidentItem {
  id: string;
  name: string;
  nameAr: string | null;
  phone: string;
  unit: string;
  language: string;
  openTickets: number;
  lastMessage: string | null;
  verified: boolean;
}

interface ConversationData {
  resident: { id: string; name: string; nameAr: string | null; phone: string; unit: string | null; language: string; verified: boolean };
  conversation: { state: string; activeTicketId: string | null } | null;
  messages: { id: string; direction: "INBOUND" | "OUTBOUND"; body: string; mediaType: string | null; mediaUrl: string | null; transcript: string | null; status: string; ticketId: string | null; createdAt: string; analysis: Record<string, unknown> | null }[];
  tickets: {
    id: string;
    ticketNumber: string;
    title: string;
    status: TicketStatus;
    priority: Priority;
    aiSuggestedPriority: Priority | null;
    category: { key: string; nameEn: string; nameAr: string } | null;
    assignee: string | null;
    asset: string | null;
    location: string | null;
    createdAt: string;
    sla: SlaDTO;
    analysis: {
      provider: string;
      issue: string | null;
      location: string | null;
      confidence: number;
      recommendedAction: string | null;
      reasoning: string | null;
      followUpQuestion: string | null;
      priority: Priority | null;
      latencyMs: number | null;
      fallbackUsed: boolean;
      entities: Record<string, unknown> | null;
    } | null;
    events: { id: string; type: string; message: string; createdAt: string }[];
  }[];
}

const QUICK_AR = ["التكييف مش شغال", "المياه بتسرب من سقف الحمام", "فيه ماسورة انفجرت", "الكهربا قاطعة في الشقة", "الأسانسير واقف", "اللمبة في المدخل اتحرقت", "الباب مش بيقفل", "السخان مش شغال", "حالة الطلب"];
const QUICK_EN = ["The AC is not cooling", "Water leaking from the bathroom ceiling", "Power outage in my apartment", "status"];

export function WhatsAppSimulator({ residents, initialResidentId }: { residents: ResidentItem[]; initialResidentId?: string }) {
  const { t, locale } = useI18n();
  const [residentId, setResidentId] = useState(initialResidentId);
  const [data, setData] = useState<ConversationData | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ body: string; at: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  /** A chat started from an unregistered number (no resident record until its first message) */
  const [newChat, setNewChat] = useState<{ phone: string; name: string } | null>(null);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const known = residents.find((r) => r.id === residentId);
  const resident: ResidentItem | undefined =
    known ??
    (newChat
      ? { id: residentId ?? "", name: newChat.name || newChat.phone, nameAr: newChat.name || newChat.phone, phone: newChat.phone, unit: "—", language: "ar", openTickets: 0, lastMessage: null, verified: false }
      : undefined);

  const load = useCallback(async () => {
    if (!residentId) return;
    try {
      setData(await api<ConversationData>(`/api/whatsapp/conversation?residentId=${residentId}`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [residentId]);

  useEffect(() => {
    setData(null);
    if (!residentId) return;
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length, pending]);

  async function send(payload: Record<string, unknown>, preview: string) {
    if (!resident) return;
    setSending(true);
    setPending({ body: preview, at: new Date().toISOString() });
    try {
      const r = await api<{ residentId?: string }>("/api/whatsapp/simulate", { body: { from: resident.phone, profileName: resident.name, ...payload } });
      if (!residentId && r.residentId) {
        // first message from a new number created its (unverified) resident record
        setResidentId(r.residentId);
        router.refresh();
      } else {
        await load();
        if (!resident.verified || resident.unit === "—") router.refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(null);
      setSending(false);
    }
  }

  async function sendText(body?: string) {
    const msg = (body ?? text).trim();
    if (!msg) return;
    setText("");
    await send({ type: "text", text: msg }, msg);
  }

  async function sendImage(file: File) {
    const base64 = await fileToBase64(file);
    const caption = text.trim() || undefined;
    setText("");
    await send({ type: "image", text: caption, media: { base64, mimeType: file.type || "image/jpeg", fileName: file.name, caption } }, `📷 ${file.name}${caption ? ` — ${caption}` : ""}`);
  }

  const active = data?.tickets.find((x) => x.id === data.conversation?.activeTicketId) ?? data?.tickets[0];
  const shown = residents.filter((r) => !filter || `${r.name} ${r.nameAr} ${r.unit} ${r.phone}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t.whatsapp.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.whatsapp.subtitle}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_330px] 2xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        {/* Residents */}
        <Card className="overflow-hidden">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.whatsapp.residents} className="ps-8" />
            </div>
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setNewOpen(true)}>
              <UserPlus /> {t.whatsapp.newNumber}
            </Button>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {shown.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setNewChat(null);
                  setResidentId(r.id);
                }}
                className={cn("flex w-full items-center gap-3 border-b px-3 py-2.5 text-start hover:bg-muted/60", r.id === residentId && "bg-accent")}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">{(r.nameAr ?? r.name).slice(0, 2)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-sm font-medium">{locale === "ar" || r.language === "ar" ? r.nameAr ?? r.name : r.name}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                      {!r.verified && <span className="rounded bg-amber-100 px-1 text-amber-800">{t.whatsapp.unverified}</span>}
                      {r.unit}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground" dir="auto">{r.lastMessage ?? r.phone}</div>
                </div>
                {r.openTickets > 0 && <span className="num rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">{r.openTickets}</span>}
              </button>
            ))}
          </div>
        </Card>

        {/* Chat */}
        <div className="flex h-[720px] flex-col overflow-hidden rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 bg-wa-header px-4 py-2.5 text-white">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-xs font-semibold">{(resident?.nameAr ?? resident?.name ?? "").slice(0, 2)}</div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{resident ? `${resident.nameAr ?? resident.name}` : "—"}</div>
              <div className="text-[11px] opacity-80" dir="ltr">{resident?.phone} · {resident?.unit}{resident && !resident.verified ? ` · ${t.whatsapp.unverified}` : ""} · {sending ? t.whatsapp.sending : t.whatsapp.online}</div>
            </div>
            <Video className="h-4 w-4 opacity-80" /><Phone className="h-4 w-4 opacity-80" /><MoreVertical className="h-4 w-4 opacity-80" />
          </div>
          <div ref={scrollRef} className="wa-pattern flex-1 space-y-1.5 overflow-y-auto px-4 py-3 sm:px-10">
            {!data && residentId && <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
            {!residentId && newChat && <p className="mx-auto mt-6 w-fit rounded-md bg-[#fff6c5] px-3 py-1.5 text-center text-xs text-slate-700">{t.whatsapp.newNumberHint}</p>}
            {data?.messages.map((m) => <Bubble key={m.id} m={m} />)}
            {pending && (
              <>
                <Bubble m={{ id: "pending", direction: "INBOUND", body: pending.body, mediaType: null, mediaUrl: null, transcript: null, status: "QUEUED", ticketId: null, createdAt: pending.at, analysis: null }} />
                <div className="flex justify-end">
                  <div className="flex items-center gap-1.5 rounded-lg bg-wa-out px-3 py-2 text-xs text-muted-foreground shadow-sm">
                    <Sparkles className="h-3.5 w-3.5 animate-pulse text-violet-600" /> {t.whatsapp.sending}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="border-t bg-[#f0f2f5] p-2">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {(resident?.language === "en" ? QUICK_EN : QUICK_AR).map((q) => (
                <button key={q} disabled={sending} onClick={() => sendText(q)} className="shrink-0 rounded-full border bg-white px-2.5 py-1 text-xs hover:bg-emerald-50" dir="auto">
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendText();
              }}
            >
              <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} />
              <Button type="button" variant="ghost" size="icon" title={t.whatsapp.attachImage} onClick={() => imageInput.current?.click()} disabled={sending}>
                <ImagePlus />
              </Button>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.whatsapp.typeMessage} className="rounded-full bg-white" dir="auto" disabled={sending} />
              {text.trim() ? (
                <Button type="submit" size="icon" className="rounded-full bg-wa-header hover:bg-wa-header/90" disabled={sending}><Send className="rtl:-scale-x-100" /></Button>
              ) : (
                <Button type="button" size="icon" className="rounded-full bg-wa-header hover:bg-wa-header/90" onClick={() => setVoiceOpen(true)} disabled={sending} title={t.whatsapp.voiceNote}><Mic /></Button>
              )}
            </form>
          </div>
        </div>

        {/* Live state */}
        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" /> {t.whatsapp.liveState}</CardTitle>
              {data?.conversation && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{data.conversation.state}</span>}
            </CardHeader>
            <CardContent>
              {!active ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.whatsapp.noTicket}</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/tickets/${active.id}`} className="num font-mono text-sm font-semibold text-primary hover:underline">{active.ticketNumber}</Link>
                    <StatusBadge status={active.status} />
                    <PriorityBadge priority={active.priority} />
                  </div>
                  <div className="flex items-center gap-1.5 font-medium"><CategoryIcon categoryKey={active.category?.key} /> {active.title}</div>
                  {active.analysis && (
                    <div className="space-y-1.5 rounded-md border bg-violet-50/40 p-3 text-xs">
                      <Row k={t.common.category} v={active.category ? (locale === "ar" ? active.category.nameAr : active.category.nameEn) : "—"} />
                      <Row k={t.detail.issue} v={`${active.analysis.issue ?? "—"}${active.analysis.entities?.issueAr ? ` · ${active.analysis.entities.issueAr}` : ""}`} />
                      <Row k={t.common.location} v={active.analysis.location ?? "—"} />
                      <Row k={t.detail.aiPriority} v={active.analysis.priority ?? "—"} />
                      <Row k={t.detail.finalPriority} v={active.priority} />
                      <Row k={t.common.asset} v={active.asset ?? "—"} />
                      <Row k={t.detail.confidence} v={`${Math.round(active.analysis.confidence * 100)}%`} />
                      <Row k={t.detail.recommended} v={active.analysis.recommendedAction ?? "—"} />
                      {active.analysis.followUpQuestion && <Row k={t.detail.followUp} v={active.analysis.followUpQuestion} />}
                      <Row k={t.detail.provider} v={`${active.analysis.provider} · ${active.analysis.latencyMs ?? 0}ms${active.analysis.fallbackUsed ? ` (${t.detail.fallback})` : ""}`} />
                      {active.analysis.reasoning && <p className="border-t pt-1.5 text-muted-foreground">{active.analysis.reasoning}</p>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-muted/60 p-2"><div className="text-muted-foreground">{t.tickets.sla}</div><SlaBadge sla={active.sla} compact /></div>
                    <div className="rounded-md bg-muted/60 p-2"><div className="text-muted-foreground">{t.common.assignee}</div><div className="font-medium">{active.assignee ?? t.common.unassigned}</div></div>
                  </div>
                  <ol className="space-y-1 border-t pt-2">
                    {active.events.slice(0, 6).map((e) => (
                      <li key={e.id} className="flex gap-2 text-[11px]">
                        <span className="num shrink-0 text-muted-foreground">{formatTime(e.createdAt, locale)}</span>
                        <span className="min-w-0 truncate" title={e.message}>{e.message}</span>
                      </li>
                    ))}
                  </ol>
                  <Button asChild variant="outline" size="sm" className="w-full"><Link href={`/tickets/${active.id}`}><ExternalLink /> {t.whatsapp.openTicket}</Link></Button>
                </div>
              )}
            </CardContent>
          </Card>
          {data && data.tickets.length > 1 && (
            <Card>
              <CardHeader><CardTitle>{t.whatsapp.activeTickets}</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {data.tickets.slice(0, 6).map((x) => (
                  <Link key={x.id} href={`/tickets/${x.id}`} className="flex items-center gap-2 rounded p-1.5 text-xs hover:bg-muted">
                    <span className="num font-mono font-semibold">{x.ticketNumber}</span>
                    <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    <StatusBadge status={x.status} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <NewNumberDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onStart={(phone, name) => {
          const existing = residents.find((r) => r.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
          if (existing) {
            setNewChat(null);
            setResidentId(existing.id);
          } else {
            setNewChat({ phone, name });
            setResidentId(undefined);
            setData(null);
          }
        }}
      />
      <VoiceDialog open={voiceOpen} onOpenChange={setVoiceOpen} onSend={(payload, preview) => send(payload, preview)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="text-end font-medium" dir="auto">{v}</span>
    </div>
  );
}

function Bubble({ m }: { m: ConversationData["messages"][number] }) {
  const { locale } = useI18n();
  // Resident (inbound to the system) is shown on the left; system replies on the right — the operator's view of the chat
  const out = m.direction === "OUTBOUND";
  return (
    <div className={cn("flex animate-fade-in", out ? "justify-end" : "justify-start")}>
      <div className={cn("relative max-w-[78%] rounded-lg px-2.5 pb-1 pt-1.5 text-[13.5px] shadow-sm", out ? "rounded-se-none bg-wa-out" : "rounded-ss-none bg-white")}>
        {m.mediaType === "IMAGE" && m.mediaUrl && <img src={m.mediaUrl} alt="" className="mb-1 max-h-52 rounded-md" />}
        {m.mediaType === "AUDIO" && (
          <div className="mb-1 flex min-w-[200px] items-center gap-2">
            <Mic className="h-4 w-4 text-emerald-700" />
            {m.mediaUrl ? <audio controls src={m.mediaUrl} className="h-8 max-w-[220px]" /> : <span className="text-xs">voice note</span>}
          </div>
        )}
        {m.body && <div className="whitespace-pre-line" dir="auto">{m.body}</div>}
        {m.transcript && <div className="mt-1 border-t border-black/5 pt-1 text-xs italic text-muted-foreground" dir="auto">🎙️ “{m.transcript}”</div>}
        {m.analysis && "issue" in m.analysis && <div className="mt-1 border-t border-black/5 pt-1 text-xs text-muted-foreground">🔍 {String(m.analysis.issue)} · {Math.round(Number(m.analysis.confidence) * 100)}%</div>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          {formatTime(m.createdAt, locale)}
          {out && (m.status === "FAILED" ? <span className="text-red-600">!</span> : <CheckCheck className="h-3 w-3 text-sky-500" />)}
          {!out && m.status === "QUEUED" && <Check className="h-3 w-3" />}
        </div>
      </div>
    </div>
  );
}

function VoiceDialog({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (o: boolean) => void; onSend: (payload: Record<string, unknown>, preview: string) => void }) {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState("التكييف في أوضة النوم مش بيبرد خالص من امبارح");
  const [file, setFile] = useState<File | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mic className="h-4 w-4" /> {t.whatsapp.voiceTitle}</DialogTitle>
          <DialogDescription>{t.whatsapp.voiceHint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t.whatsapp.audioFile}</Label>
          <Input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t.whatsapp.transcript}</Label>
          <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} dir="auto" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button
            onClick={async () => {
              const base64 = file ? await fileToBase64(file) : undefined;
              onOpenChange(false);
              onSend(
                { type: "audio", media: { base64, mimeType: file?.type || "audio/ogg", fileName: file?.name ?? "voice-note.ogg", simulatedTranscript: transcript } },
                `🎙️ voice note (0:0${Math.min(9, Math.ceil(transcript.length / 12))})`,
              );
            }}
          >
            <Paperclip /> {t.whatsapp.sendVoice}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewNumberDialog({ open, onOpenChange, onStart }: { open: boolean; onOpenChange: (o: boolean) => void; onStart: (phone: string, name: string) => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(() => `+2011${Math.floor(10000000 + Math.random() * 89999999)}`);
  const [name, setName] = useState("");
  const valid = phone.replace(/\D/g, "").length >= 8;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> {t.whatsapp.newNumberTitle}</DialogTitle>
          <DialogDescription>{t.whatsapp.newNumberHint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t.whatsapp.phone}</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label>{t.whatsapp.profileName}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="أحمد سمير" dir="auto" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onStart(`+${phone.replace(/\D/g, "")}`, name.trim());
              onOpenChange(false);
            }}
          >
            {t.whatsapp.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

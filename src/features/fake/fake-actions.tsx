"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, ShieldCheck, ShieldX, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/api-client";

function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function call(key: string, url: string, init: { method?: string; body?: unknown }, success: string) {
    setBusy(key);
    try {
      await api(url, init);
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { call, busy };
}

/** Confirm / confirm & block / not fake — for one pending report. */
export function ReviewButtons({ reportId, phone, blocked, cancelled }: { reportId: string; phone: string; blocked: boolean; cancelled: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { call, busy } = useCall();
  const decide = async (decision: "confirm" | "confirm_block" | "dismiss") => {
    const ok = await call(decision, `/api/fake-reports/${reportId}`, { body: { decision, note: note || null } }, decision === "dismiss" && cancelled ? t.fake.restored : t.fake.done);
    if (ok) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{t.fake.review}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.fake.review} · <span dir="ltr">{phone}</span></DialogTitle>
          <DialogDescription>{cancelled ? t.fake.reportHint : null}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t.fake.note}</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!blocked && (
            <Button variant="destructive" disabled={!!busy} onClick={() => decide("confirm_block")}>
              {busy === "confirm_block" ? <Loader2 className="animate-spin" /> : <Ban />} {t.fake.confirmBlock}
            </Button>
          )}
          <Button variant="outline" className="text-red-700" disabled={!!busy} onClick={() => decide("confirm")}>
            {busy === "confirm" ? <Loader2 className="animate-spin" /> : <ShieldX />} {t.fake.confirm}
          </Button>
          <Button variant="outline" className="text-emerald-700" disabled={!!busy} onClick={() => decide("dismiss")}>
            {busy === "dismiss" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {cancelled ? t.fake.dismiss : t.fake.dismissNoRestore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Block a number straight from a report row (or the "Block a number" form). */
export function BlockButton({ phone, reason, size = "sm" }: { phone: string; reason: string; size?: "sm" | "default" }) {
  const { t } = useI18n();
  const { call, busy } = useCall();
  return (
    <Button size={size} variant="outline" className="text-red-700" disabled={!!busy} onClick={() => call("block", "/api/blocked-phones", { body: { phone, reason } }, t.fake.done)}>
      {busy ? <Loader2 className="animate-spin" /> : <Ban />} {t.fake.block}
    </Button>
  );
}

export function UnblockButton({ phone }: { phone: string }) {
  const { t } = useI18n();
  const { call, busy } = useCall();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!!busy}
      onClick={() => window.confirm(t.fake.unblockConfirm.replace("{phone}", phone)) && call("unblock", "/api/blocked-phones", { method: "DELETE", body: { phone } }, t.fake.done)}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Unlock />} {t.fake.unblock}
    </Button>
  );
}

export function BlockNumberDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const { call, busy } = useCall();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Ban /> {t.fake.blockNumber}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.fake.blockNumber}</DialogTitle>
          <DialogDescription>{t.fake.blockedHint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t.fake.phone}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2010…" dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label>{t.fake.blockReason}</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            variant="destructive"
            disabled={!!busy || phone.replace(/\D/g, "").length < 8}
            onClick={async () => {
              if (await call("block", "/api/blocked-phones", { body: { phone, reason } }, t.fake.done)) {
                setOpen(false);
                setPhone("");
                setReason("");
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {t.fake.block}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

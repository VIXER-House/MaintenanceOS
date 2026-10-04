"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/domain/page-header";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/api-client";
import { PRIORITIES } from "@/server/domain/constants";
import { PRIORITY_LABELS } from "@/server/domain/labels";

export function NewTicketForm({
  residents,
  categories,
}: {
  residents: { id: string; name: string; nameAr: string | null; unit: string }[];
  categories: { key: string; nameEn: string; nameAr: string }[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [residentId, setResidentId] = useState(residents[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("PHONE");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string; ticketNumber: string }>("/api/tickets", {
        body: { residentId, description, categoryKey: categoryKey || null, priority: priority || null, source },
      });
      toast.success(`${r.ticketNumber} ✓`);
      router.push(`/tickets/${r.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.tickets.createTitle} subtitle={t.tickets.createSubtitle} />
      <Card>
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t.tickets.selectResident}</Label>
                <Select value={residentId} onChange={(e) => setResidentId(e.target.value)}>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.unit} — {locale === "ar" ? r.nameAr ?? r.name : r.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t.tickets.source}</Label>
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="PHONE">Phone</option>
                  <option value="WEB">Web / walk-in</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t.tickets.description}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="المياه بتسرب من سقف الحمام" required minLength={3} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t.tickets.overrideCategory}</Label>
                <Select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
                  <option value="">✨ {t.tickets.aiWillDecide}</option>
                  {categories.map((c) => <option key={c.key} value={c.key}>{locale === "ar" ? c.nameAr : c.nameEn}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t.tickets.overridePriority}</Label>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">✨ {t.tickets.aiWillDecide}</option>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p][locale]}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>{t.common.cancel}</Button>
              <Button type="submit" disabled={busy || description.trim().length < 3}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {t.tickets.create}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PriorityBadge } from "@/components/domain/badges";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/client";
import { PRIORITIES, type Priority } from "@/server/domain/constants";
import { PRIORITY_LABELS } from "@/server/domain/labels";

export interface RuleRow {
  priority: Priority;
  reason: string;
  keywords: string[];
}

// ───────────────────────── duration input (value + unit) ─────────────────────────

type Unit = "min" | "h" | "d";
const UNIT_MIN: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

function splitMinutes(m: number): { value: number; unit: Unit } {
  if (m % 1440 === 0) return { value: m / 1440, unit: "d" };
  if (m % 60 === 0) return { value: m / 60, unit: "h" };
  return { value: m, unit: "min" };
}

function DurationInput({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState(() => splitMinutes(minutes));
  const update = (next: { value: number; unit: Unit }) => {
    setState(next);
    onChange(Math.round(next.value * UNIT_MIN[next.unit]));
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={1}
        step="any"
        value={Number.isFinite(state.value) ? state.value : ""}
        onChange={(e) => update({ ...state, value: Number(e.target.value) })}
        className="h-8 w-16 px-2 num"
        dir="ltr"
      />
      <Select value={state.unit} onChange={(e) => update({ ...state, unit: e.target.value as Unit })} className="h-8 w-[5.5rem] px-2">
        <option value="min">{t.settings.minutes}</option>
        <option value="h">{t.settings.hours}</option>
        <option value="d">{t.settings.days}</option>
      </Select>
    </div>
  );
}

// ───────────────────────── SLA policies ─────────────────────────

export function SlaEditor({ policies }: { policies: { priority: Priority; responseMinutes: number; resolutionMinutes: number }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState(policies);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(policies);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-3">
      <Table>
        <THead>
          <TR>
            <TH>{t.common.priority}</TH>
            <TH>{t.settings.response}</TH>
            <TH>{t.settings.resolution}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((p, i) => (
            <TR key={p.priority}>
              <TD><PriorityBadge priority={p.priority} /></TD>
              <TD><DurationInput minutes={p.responseMinutes} onChange={(m) => set(i, { responseMinutes: m })} /></TD>
              <TD><DurationInput minutes={p.resolutionMinutes} onChange={(m) => set(i, { resolutionMinutes: m })} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t.settings.slaHint}</p>
      <Button
        size="sm"
        disabled={!dirty || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/settings/sla", { method: "PUT", body: { policies: rows } });
            toast.success(t.settings.saved);
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Save />} {t.settings.save}
      </Button>
    </div>
  );
}

// ───────────────────────── keyword → priority rules ─────────────────────────

const toKeywords = (s: string) =>
  s
    .split(/[,،\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

/** Editable list of rules. Keywords are edited as text and parsed on change. */
function RulesEditor({ rules, onChange }: { rules: RuleRow[]; onChange: (r: RuleRow[]) => void }) {
  const { t, locale } = useI18n();
  const [texts, setTexts] = useState(() => rules.map((r) => r.keywords.join("، ")));
  const set = (i: number, patch: Partial<RuleRow>) => onChange(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {!rules.length && <p className="text-xs text-muted-foreground">{t.settings.noRules}</p>}
      {rules.map((r, i) => (
        <div key={i} className="space-y-1.5 rounded-md border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={r.priority} onChange={(e) => set(i, { priority: e.target.value as Priority })} className="h-8 w-32">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p][locale]}</option>
              ))}
            </Select>
            <Input value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} placeholder={t.settings.reason} className="h-8 min-w-40 flex-1" dir="auto" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t.settings.remove}
              onClick={() => {
                setTexts((x) => x.filter((_, j) => j !== i));
                onChange(rules.filter((_, j) => j !== i));
              }}
            >
              <Trash2 className="text-red-600" />
            </Button>
          </div>
          <Textarea
            rows={2}
            dir="auto"
            value={texts[i] ?? ""}
            placeholder={t.settings.keywords}
            onChange={(e) => {
              const v = e.target.value;
              setTexts((x) => x.map((y, j) => (j === i ? v : y)));
              set(i, { keywords: toKeywords(v) });
            }}
            className="text-xs"
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setTexts((x) => [...x, ""]);
          onChange([...rules, { priority: "HIGH", reason: "", keywords: [] }]);
        }}
      >
        <Plus /> {t.settings.addRule}
      </Button>
    </div>
  );
}

function rulesError(rules: RuleRow[], locale: "en" | "ar"): string | null {
  const bad = rules.findIndex((r) => !r.reason.trim() || !r.keywords.length);
  if (bad < 0) return null;
  return locale === "ar" ? `القاعدة رقم ${bad + 1}: اكتب السبب وكلمة مفتاحية واحدة على الأقل` : `Rule ${bad + 1}: enter a reason and at least one keyword`;
}

// ───────────────────────── global safety rules ─────────────────────────

export function GlobalRulesEditor({ rules: initial, isDefault }: { rules: RuleRow[]; isDefault: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [version, setVersion] = useState(0); // remount the editor after a reset
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rules) !== JSON.stringify(initial);
  const send = async (body: unknown) => {
    setBusy(true);
    try {
      const r = await api<{ rules: RuleRow[] }>("/api/settings/priority-rules", { method: "PUT", body });
      setRules(r.rules);
      setVersion((v) => v + 1);
      toast.success(t.settings.saved);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <RulesEditor key={version} rules={rules} onChange={setRules} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={() => {
            const err = rulesError(rules, locale);
            if (err) return toast.error(err);
            send({ rules });
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Save />} {t.settings.save}
        </Button>
        {!isDefault && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm(t.settings.confirmReset) && send({ reset: true })}>
            <RotateCcw /> {t.settings.resetDefaults}
          </Button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── category ─────────────────────────

export interface CategoryRow {
  id: string;
  nameEn: string;
  nameAr: string;
  description: string;
  defaultPriority: Priority;
  defaultResolutionMinutes: number;
  requiredSkill: string;
  quotationThreshold: number;
  priorityRules: RuleRow[];
  keywords: string[];
}

export function CategoryEditButton({ category }: { category: CategoryRow }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(category);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CategoryRow>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setForm(category);
          setOpen(true);
        }}
      >
        <Pencil /> {t.settings.edit}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.settings.editCategory}</DialogTitle>
            <DialogDescription>{locale === "ar" ? category.nameAr : category.nameEn}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t.settings.nameEn}</Label>
              <Input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label>{t.settings.nameAr}</Label>
              <Input value={form.nameAr} onChange={(e) => set({ nameAr: e.target.value })} dir="rtl" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t.settings.description}</Label>
              <Input value={form.description} onChange={(e) => set({ description: e.target.value })} dir="auto" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t.manage.f.keywords}</Label>
              <Textarea
                rows={2}
                dir="auto"
                className="text-xs"
                defaultValue={form.keywords.join("، ")}
                key={open ? "kw-open" : "kw-closed"}
                onChange={(e) => set({ keywords: e.target.value.split(/[,،\n]/).map((k) => k.trim()).filter(Boolean) })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t.settings.defaultPriority}</Label>
              <Select value={form.defaultPriority} onChange={(e) => set({ defaultPriority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p][locale]}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t.settings.defaultSla}</Label>
              <DurationInput minutes={form.defaultResolutionMinutes} onChange={(m) => set({ defaultResolutionMinutes: m })} />
            </div>
            <div className="space-y-1">
              <Label>{t.settings.skill}</Label>
              <Input value={form.requiredSkill} onChange={(e) => set({ requiredSkill: e.target.value.toUpperCase() })} dir="ltr" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>{t.settings.threshold} (EGP)</Label>
              <Input type="number" min={0} value={form.quotationThreshold} onChange={(e) => set({ quotationThreshold: Number(e.target.value) })} dir="ltr" className="num" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t.settings.rules}</Label>
            <RulesEditor key={open ? "open" : "closed"} rules={form.priorityRules} onChange={(r) => set({ priorityRules: r })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t.settings.cancel}</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                const err = rulesError(form.priorityRules, locale);
                if (err) return toast.error(err);
                setBusy(true);
                try {
                  const { id, ...body } = form;
                  await api(`/api/settings/categories/${id}`, { method: "PATCH", body });
                  toast.success(t.settings.saved);
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} {t.settings.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

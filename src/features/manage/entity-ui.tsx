"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Check, Copy, KeyRound, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Serializable form-field description (built on the server page, rendered here). */
export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "email" | "phone" | "number" | "select" | "multiselect" | "checkbox" | "date" | "textarea" | "tags" | "lookup";
  required?: boolean;
  options?: { value: string; label: string }[];
  lookup?: "units" | "buildings";
  placeholder?: string;
  dir?: "ltr" | "rtl" | "auto";
  wide?: boolean;
  hint?: string;
  /** Only shown when creating */
  createOnly?: boolean;
}
export type Entity = "residents" | "units" | "buildings" | "technicians" | "contractors" | "assets" | "categories" | "teams" | "users";
type Values = Record<string, unknown>;
interface Credentials {
  email: string;
  password: string;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message ?? `Request failed (${res.status})`) as Error & { code?: string; details?: { canArchive?: boolean } };
    err.code = json?.error?.code;
    err.details = json?.error?.details;
    throw err;
  }
  return json as T;
}

// ───────────────────────── credentials (shown once) ─────────────────────────

export function CredentialsDialog({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> {t.manage.credsTitle}</DialogTitle>
          <DialogDescription>{t.manage.credsHint}</DialogDescription>
        </DialogHeader>
        {creds && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 font-mono text-sm" dir="ltr">
            <div>{creds.email}</div>
            <div className="text-lg font-semibold tracking-wider">{creds.password}</div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => creds && navigator.clipboard.writeText(`${creds.email}\n${creds.password}`).then(() => setCopied(true))}
          >
            {copied ? <Check /> : <Copy />} {copied ? t.manage.copied : t.manage.copy}
          </Button>
          <Button onClick={onClose}>OK</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── fields ─────────────────────────

function LookupInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<{ value: string; label: string }[]>([]);
  const id = `dl-${field.name}`;
  useEffect(() => {
    const h = setTimeout(() => {
      fetch(`/api/manage/lookup?type=${field.lookup}&q=${encodeURIComponent(value ?? "")}`)
        .then((r) => r.json())
        .then((j) => setItems(j.items ?? []))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(h);
  }, [value, field.lookup]);
  return (
    <>
      <Input list={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} dir="ltr" autoComplete="off" />
      <datalist id={id}>
        {items.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </datalist>
    </>
  );
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? (field.type === "multiselect" || field.type === "tags" ? [] : field.type === "checkbox" ? false : "");
  switch (field.type) {
    case "select":
      return (
        <Select value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">—</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      );
    case "multiselect":
      return (
        <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
          {field.options?.map((o) => {
            const on = (v as string[]).includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(on ? (v as string[]).filter((x) => x !== o.value) : [...(v as string[]), o.value])}
                className={cn("rounded-full border px-2.5 py-1 text-xs transition", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    case "textarea":
      return <Textarea rows={3} value={String(v)} onChange={(e) => onChange(e.target.value)} dir={field.dir ?? "auto"} />;
    case "tags":
      return (
        <Textarea
          rows={3}
          dir="auto"
          defaultValue={(v as string[]).join("، ")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(/[,،\n]/)
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case "lookup":
      return <LookupInput field={field} value={String(v)} onChange={onChange} />;
    case "date":
      return <Input type="date" value={String(v).slice(0, 10)} onChange={(e) => onChange(e.target.value)} dir="ltr" />;
    case "number":
      return <Input type="number" value={String(v)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} dir="ltr" className="num" />;
    default:
      return (
        <Input
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          value={String(v)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          dir={field.dir ?? (field.type === "email" || field.type === "phone" ? "ltr" : "auto")}
        />
      );
  }
}

// ───────────────────────── create / edit dialog ─────────────────────────

export function EntityFormButton({
  entity,
  fields,
  record,
  title,
  buttonLabel,
  defaults,
  variant,
  apiPath,
}: {
  entity: Entity;
  fields: FieldDef[];
  record?: { id: string } & Values;
  title: string;
  buttonLabel?: string;
  defaults?: Values;
  variant?: "default" | "outline" | "ghost";
  /** Override the endpoint (e.g. settings category route) */
  apiPath?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const editing = !!record;
  const visible = fields.filter((f) => !(editing && f.createOnly));

  const start = () => {
    setValues({ ...(defaults ?? {}), ...(record ?? {}) });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = visible.find((f) => f.required && (values[f.name] === undefined || values[f.name] === "" || (Array.isArray(values[f.name]) && !(values[f.name] as unknown[]).length)));
    if (missing) return toast.error(`${missing.label}: ${t.manage.required}`);
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(values).filter(([k]) => k !== "id"));
      const r = editing
        ? await call<{ record: Values }>(apiPath ?? `/api/manage/${entity}/${record!.id}`, "PATCH", body)
        : await call<{ record: Values & { credentials?: Credentials } }>(apiPath ?? `/api/manage/${entity}`, "POST", body);
      toast.success(t.manage.saved);
      setOpen(false);
      const c = (r.record as { credentials?: Credentials })?.credentials;
      if (c) setCreds(c);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing ? (
        <Button variant={variant ?? "ghost"} size="sm" onClick={start} aria-label={t.manage.edit}>
          <Pencil /> {buttonLabel}
        </Button>
      ) : (
        <Button variant={variant ?? "default"} onClick={start}>
          <Plus /> {buttonLabel ?? t.manage.add}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {visible.map((f) => (
                <div key={f.name} className={cn("space-y-1", (f.wide || f.type === "multiselect" || f.type === "textarea" || f.type === "tags") && "sm:col-span-2")}>
                  {f.type !== "checkbox" && (
                    <Label>
                      {f.label}
                      {f.required && <span className="text-red-600"> *</span>}
                    </Label>
                  )}
                  <FieldInput field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
                  {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.manage.cancel}</Button>
              <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />} {t.manage.save}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </>
  );
}

// ───────────────────────── row actions ─────────────────────────

export function RowActions({
  entity,
  id,
  name,
  active = true,
  canArchive,
  canDelete = true,
  canResetPassword,
  edit,
}: {
  entity: Entity;
  id: string;
  name: string;
  active?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
  canResetPassword?: boolean;
  edit?: { fields: FieldDef[]; record: Values; title: string; apiPath?: string };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const act = async (action: "archive" | "restore" | "resetPassword") => {
    setBusy(true);
    try {
      const r = await call<{ credentials?: Credentials }>(`/api/manage/${entity}/${id}`, "POST", { action });
      if (r.credentials) setCreds(r.credentials);
      else toast.success(action === "archive" ? t.manage.archivedMsg : t.manage.restoredMsg);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(fill(t.manage.confirmDelete, { name }))) return;
    setBusy(true);
    try {
      await call(`/api/manage/${entity}/${id}`, "DELETE");
      toast.success(t.manage.deleted);
      router.refresh();
    } catch (e) {
      const err = e as Error & { code?: string; details?: { canArchive?: boolean } };
      if (err.code === "IN_USE" && err.details?.canArchive && canArchive && active) {
        if (window.confirm(fill(t.manage.archiveInstead, { msg: err.message }))) await act("archive");
      } else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {edit && active && <EntityFormButton entity={entity} fields={edit.fields} record={{ id, ...edit.record }} title={edit.title} apiPath={edit.apiPath} />}
      {canResetPassword && active && (
        <Button variant="ghost" size="sm" disabled={busy} title={t.manage.resetPassword} aria-label={t.manage.resetPassword} onClick={() => window.confirm(fill(t.manage.confirmReset, { name })) && act("resetPassword")}>
          <KeyRound />
        </Button>
      )}
      {canArchive &&
        (active ? (
          <Button variant="ghost" size="sm" disabled={busy} title={t.manage.archive} aria-label={t.manage.archive} onClick={() => window.confirm(fill(t.manage.confirmArchive, { name })) && act("archive")}>
            <Archive />
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => act("restore")}>
            <ArchiveRestore /> {t.manage.restore}
          </Button>
        ))}
      {canDelete && (
        <Button variant="ghost" size="sm" disabled={busy} title={t.manage.delete} aria-label={t.manage.delete} onClick={remove} className="text-red-600 hover:text-red-700">
          <Trash2 />
        </Button>
      )}
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}

// ───────────────────────── list controls (search / archived / paging via URL) ─────────────────────────

export function ListControls({ showArchivedToggle = true, extra }: { showArchivedToggle?: boolean; extra?: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [archived, setArchived] = useState(params.get("archived") === "1");
  const first = useRef(true);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v === null || v === "" ? next.delete(k) : next.set(k, v);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = setTimeout(() => go({ q }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.manage.search} className="ps-8" />
      </div>
      {showArchivedToggle && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              go({ archived: e.target.checked ? "1" : null });
            }}
          />
          {t.manage.showArchived}
        </label>
      )}
      {extra}
    </div>
  );
}

export function Pager({ page, pages, total }: { page: number; pages: number; total: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const to = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`, { scroll: true });
  };
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{fill(t.manage.results, { n: total.toLocaleString() })}</span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => to(page - 1)}>{t.manage.prev}</Button>
          <span>{fill(t.manage.page, { p: page, n: pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => to(page + 1)}>{t.manage.next}</Button>
        </div>
      )}
    </div>
  );
}

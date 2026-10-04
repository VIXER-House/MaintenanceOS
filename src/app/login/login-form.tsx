"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wrench, MessageCircle, Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useI18n, useSetLocale } from "@/lib/i18n/client";

const DEMO = [
  { email: "manager@demo.com", role: "COMPOUND_MANAGER" },
  { email: "maintenance@demo.com", role: "MAINTENANCE_MANAGER" },
  { email: "mohamed@demo.com", role: "TECHNICIAN", note: "HVAC" },
  { email: "ahmed@demo.com", role: "TECHNICIAN", note: "Plumbing" },
  { email: "contractor@demo.com", role: "CONTRACTOR", note: "Nile HVAC" },
  { email: "resident@demo.com", role: "RESIDENT" },
] as const;

export function LoginForm() {
  const { t, locale } = useI18n();
  const setLocale = useSetLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("manager@demo.com");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>("/api/auth/login", { body: { email: override ?? email, password: override ? "demo1234" : password } });
      router.replace(params.get("next") || r.redirectTo);
      router.refresh();
    } catch {
      setError(t.login.invalid);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary"><Wrench className="h-5 w-5 text-white" /></span>
          MaintenanceOS
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">{t.app.tagline}</h2>
          <div className="mt-8 space-y-3 text-sm">
            <div className="w-fit max-w-xs rounded-lg rounded-ss-none bg-white/10 px-3 py-2" dir="rtl">المياه بتسرب من سقف الحمام</div>
            <div className="ms-auto w-fit max-w-xs rounded-lg rounded-se-none bg-emerald-600/90 px-3 py-2" dir="rtl">
              تمام، سجلت طلب صيانة رقم MAINT-000123 ✅<br />التصنيف: سباكة · الأولوية: عالي · الاستجابة خلال ساعتين
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-sidebar-muted">
          <MessageCircle className="h-4 w-4" /> WhatsApp → AI triage → SLA → dispatch → quotation → history
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-lg font-semibold">{t.login.title}</h1>
            <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
              <Languages /> {t.common.language}
            </Button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t.login.email}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t.login.password}</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {t.login.submit}
            </Button>
          </form>
          <div className="mt-8">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t.login.demoAccounts} · {t.login.subtitle}</p>
            <div className="grid gap-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => submit(undefined, d.email)}
                  disabled={busy}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-start text-sm hover:border-primary/40 hover:bg-accent"
                >
                  <span dir="ltr" className="font-mono text-xs">{d.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.roles[d.role]}
                    {"note" in d ? ` · ${d.note}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

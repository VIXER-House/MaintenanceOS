import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { getConfig } from "@/lib/config";
import { getAIProvider } from "@/server/providers/ai";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { getSpeechProvider } from "@/server/providers/speech";
import { getVisionProvider } from "@/server/providers/vision";
import { GLOBAL_PRIORITY_RULES } from "@/server/engines/priority/rules";
import { APPROVAL_LIMITS } from "@/server/engines/quotation/quotation-engine";
import type { PriorityRule } from "@/server/domain/categories";
import { PageHeader } from "@/components/domain/page-header";
import { AiTestCard, WebhookInfoCard } from "@/features/settings/integration-tools";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const [policies, categories] = await Promise.all([
    db.slaPolicy.findMany(),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const order = ["EMERGENCY", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
  policies.sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
  const cfg = getConfig();
  const providers = [
    { name: "AI", value: `${getAIProvider().name}${getAIProvider().model ? ` · ${getAIProvider().model}` : ""}`, env: "AI_PROVIDER", configured: cfg.AI_PROVIDER },
    { name: "WhatsApp", value: getWhatsAppProvider().name, env: "WHATSAPP_PROVIDER", configured: cfg.WHATSAPP_PROVIDER },
    { name: "Speech-to-text", value: getSpeechProvider().name, env: "SPEECH_PROVIDER", configured: cfg.SPEECH_PROVIDER },
    { name: "Vision", value: getVisionProvider().name, env: "VISION_PROVIDER", configured: cfg.VISION_PROVIDER },
    { name: "Notifications", value: `mock · ${cfg.NOTIFICATION_CHANNELS}`, env: "NOTIFICATION_CHANNELS", configured: cfg.NOTIFICATION_CHANNELS },
  ];
  return (
    <div>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AiTestCard />
        <WebhookInfoCard verifyToken={cfg.WHATSAPP_VERIFY_TOKEN} provider={getWhatsAppProvider().name} />
        <Card>
          <CardHeader><CardTitle>{t.settings.providers}</CardTitle><CardDescription>.env — every integration is optional and falls back to a local mock.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                <div><div className="font-medium">{p.name}</div><div className="font-mono text-[11px] text-muted-foreground">{p.env}={p.configured}</div></div>
                <Badge variant="outline" className={p.value.startsWith("mock") ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                  {p.value.startsWith("mock") ? t.settings.mock : t.settings.live} · {p.value}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t.settings.sla}</CardTitle><CardDescription>SLA table · approval limits: {Object.entries(APPROVAL_LIMITS).map(([r, v]) => `${r.replace("_", " ").toLowerCase()} ≤ ${Number.isFinite(v) ? formatMoney(v!, locale) : "∞"}`).join(" · ")}</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>{t.common.priority}</TH><TH>{t.sla.response}</TH><TH>{t.sla.resolution}</TH></TR></THead>
              <TBody>
                {policies.map((p) => (
                  <TR key={p.id}><TD><PriorityBadge priority={p.priority} /></TD><TD className="num">{formatMinutes(p.responseMinutes, locale)}</TD><TD className="num">{formatMinutes(p.resolutionMinutes, locale)}</TD></TR>
                ))}
              </TBody>
            </Table>
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Global safety rules (floor — AI can never go below)</div>
              <div className="space-y-1">
                {GLOBAL_PRIORITY_RULES.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <PriorityBadge priority={r.priority} />
                    <span><span className="font-medium">{r.reason}</span> <span className="text-muted-foreground" dir="auto">— {r.keywords.slice(0, 6).join("، ")}…</span></span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t.settings.categories}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>{t.common.category}</TH><TH>{t.common.priority}</TH><TH>{t.settings.defaultSla}</TH><TH>{t.settings.skill}</TH><TH>{t.settings.threshold}</TH><TH>{t.settings.rules}</TH></TR></THead>
              <TBody>
                {categories.map((c) => {
                  const rules = c.priorityRules as unknown as PriorityRule[];
                  return (
                    <TR key={c.id}>
                      <TD><div className="flex items-center gap-2"><CategoryIcon categoryKey={c.key} /><div><div className="font-medium">{locale === "ar" ? c.nameAr : c.nameEn}</div><div className="max-w-xs text-xs text-muted-foreground">{c.description}</div></div></div></TD>
                      <TD><PriorityBadge priority={c.defaultPriority} /></TD>
                      <TD className="num text-xs">{formatMinutes(c.defaultResolutionMinutes, locale)}</TD>
                      <TD className="font-mono text-xs">{c.requiredSkill}</TD>
                      <TD className="num text-xs">{formatMoney(Number(c.quotationThreshold), locale)}</TD>
                      <TD className="text-xs">{rules.length ? rules.map((r, i) => <div key={i}><span className="font-medium">{r.priority}</span> · {r.reason}</div>) : <span className="text-muted-foreground">—</span>}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

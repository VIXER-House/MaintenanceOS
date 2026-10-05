import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { GLOBAL_PRIORITY_RULES } from "@/server/engines/priority/rules";
import { APPROVAL_LIMITS } from "@/server/engines/quotation/quotation-engine";
import { DEFAULT_SLA_POLICIES } from "@/server/engines/sla/sla-engine";
import { PRIORITIES, type Priority } from "@/server/domain/constants";
import type { PriorityRule } from "@/server/domain/categories";
import { getGlobalPriorityRules } from "@/server/services/settings.service";
import { PageHeader } from "@/components/domain/page-header";
import { BridgeLinkCard } from "@/features/settings/integration-tools";
import { CategoryEditButton, GlobalRulesEditor, SlaEditor } from "@/features/settings/config-editors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityBadge } from "@/components/domain/badges";
import { CategoryIcon } from "@/components/domain/category-icon";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const [rows, categories, globalRules] = await Promise.all([
    db.slaPolicy.findMany(),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
    getGlobalPriorityRules(),
  ]);
  const policies = PRIORITIES.map((priority) => {
    const r = rows.find((x) => x.priority === priority);
    return { priority: priority as Priority, responseMinutes: r?.responseMinutes ?? DEFAULT_SLA_POLICIES[priority].responseMinutes, resolutionMinutes: r?.resolutionMinutes ?? DEFAULT_SLA_POLICIES[priority].resolutionMinutes };
  });
  const isDefaultRules = JSON.stringify(globalRules) === JSON.stringify(GLOBAL_PRIORITY_RULES);
  const bridge = getWhatsAppProvider().name === "bridge";

  return (
    <div>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.sla}</CardTitle>
            <CardDescription>
              {Object.entries(APPROVAL_LIMITS)
                .map(([r, v]) => `${r.replace("_", " ").toLowerCase()} ≤ ${Number.isFinite(v) ? formatMoney(v!, locale) : "∞"}`)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SlaEditor policies={policies} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.globalRules}</CardTitle>
            <CardDescription>{t.settings.globalRulesHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <GlobalRulesEditor rules={globalRules} isDefault={isDefaultRules} />
          </CardContent>
        </Card>
        {bridge && <BridgeLinkCard />}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t.settings.categories}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>{t.common.category}</TH>
                  <TH>{t.common.priority}</TH>
                  <TH>{t.settings.defaultSla}</TH>
                  <TH>{t.settings.skill}</TH>
                  <TH>{t.settings.threshold}</TH>
                  <TH>{t.settings.rules}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {categories.map((c) => {
                  const rules = (c.priorityRules as unknown as PriorityRule[]) ?? [];
                  return (
                    <TR key={c.id}>
                      <TD><div className="flex items-center gap-2"><CategoryIcon categoryKey={c.key} /><div><div className="font-medium">{locale === "ar" ? c.nameAr : c.nameEn}</div><div className="max-w-xs text-xs text-muted-foreground">{c.description}</div></div></div></TD>
                      <TD><PriorityBadge priority={c.defaultPriority} /></TD>
                      <TD className="num text-xs">{formatMinutes(c.defaultResolutionMinutes, locale)}</TD>
                      <TD className="font-mono text-xs">{c.requiredSkill}</TD>
                      <TD className="num text-xs">{formatMoney(Number(c.quotationThreshold), locale)}</TD>
                      <TD className="text-xs">{rules.length ? rules.map((r, i) => <div key={i}><span className="font-medium">{r.priority}</span> · {r.reason}</div>) : <span className="text-muted-foreground">—</span>}</TD>
                      <TD>
                        <CategoryEditButton
                          category={{
                            id: c.id,
                            nameEn: c.nameEn,
                            nameAr: c.nameAr,
                            description: c.description,
                            defaultPriority: c.defaultPriority as Priority,
                            defaultResolutionMinutes: c.defaultResolutionMinutes,
                            requiredSkill: c.requiredSkill,
                            quotationThreshold: Number(c.quotationThreshold),
                            priorityRules: rules,
                          }}
                        />
                      </TD>
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

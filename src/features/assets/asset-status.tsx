"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  OPERATIONAL: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NEEDS_ATTENTION: "border-amber-200 bg-amber-50 text-amber-800",
  UNDER_MAINTENANCE: "border-teal-200 bg-teal-50 text-teal-700",
  OUT_OF_SERVICE: "border-red-200 bg-red-50 text-red-700",
  RETIRED: "border-slate-200 bg-slate-50 text-slate-500",
};

export function AssetStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge variant="outline" className={cn(STYLE[status])}>{t.assets[status as keyof typeof t.assets] ?? status}</Badge>;
}

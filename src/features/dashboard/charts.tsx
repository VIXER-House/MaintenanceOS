"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/format";
import { PRIORITY_LABELS } from "@/server/domain/labels";
import type { DashboardData } from "@/server/services/dashboard.service";

// Validated categorical slots (fixed order) + reserved status colors
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const GOOD = "#0ca30c";
const CRITICAL = "#d03b3b";
const GRID = "#e1e0d9";
const MUTED = "#898781";

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: { stroke: "#c3c2b7" } } as const;
const tooltipStyle = { contentStyle: { borderRadius: 8, border: "1px solid rgba(11,11,11,0.1)", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" } };

export function TicketsOverTime({ data }: { data: DashboardData["ticketsOverTime"] }) {
  const { t, locale } = useI18n();
  const rows = data.map((d) => ({ ...d, label: new Date(d.date).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) }));
  return (
    <div className="h-[26rem]" dir="ltr">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...axis} interval={4} reversed={locale === "ar"} />
          <YAxis {...axis} allowDecimals={false} orientation={locale === "ar" ? "right" : "left"} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="created" name={t.dashboard.createdSeries} fill={SERIES_1} radius={[3, 3, 0, 0]} maxBarSize={10} />
          <Bar dataKey="completed" name={t.dashboard.completedSeries} fill={SERIES_2} radius={[3, 3, 0, 0]} maxBarSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBars({ data }: { data: DashboardData["byCategory"] }) {
  const { locale } = useI18n();
  const rows = [...data].sort((a, b) => b.total + b.open - (a.total + a.open)).map((d) => ({ name: locale === "ar" ? d.nameAr : d.nameEn, total: d.total }));
  return (
    <div className="h-64" dir="ltr">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...axis} allowDecimals={false} reversed={locale === "ar"} />
          <YAxis type="category" dataKey="name" {...axis} width={90} orientation={locale === "ar" ? "right" : "left"} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar dataKey="total" name="Tickets" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostBars({ data }: { data: DashboardData["byCategory"] }) {
  const { locale } = useI18n();
  const rows = data.filter((d) => d.cost > 0).sort((a, b) => b.cost - a.cost).map((d) => ({ name: locale === "ar" ? d.nameAr : d.nameEn, cost: Math.round(d.cost) }));
  return (
    <div className="h-64" dir="ltr">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...axis} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} reversed={locale === "ar"} />
          <YAxis type="category" dataKey="name" {...axis} width={90} orientation={locale === "ar" ? "right" : "left"} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => formatMoney(v, locale)} />
          <Bar dataKey="cost" name="EGP" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SlaStack({ data }: { data: DashboardData["slaByPriority"] }) {
  const { t, locale } = useI18n();
  const rows = data.map((d) => ({ ...d, name: PRIORITY_LABELS[d.priority][locale] }));
  return (
    <div className="h-64" dir="ltr">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" {...axis} reversed={locale === "ar"} />
          <YAxis {...axis} allowDecimals={false} orientation={locale === "ar" ? "right" : "left"} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="met" name={`✓ ${t.dashboard.met}`} stackId="a" fill={GOOD} stroke="#fff" strokeWidth={2} maxBarSize={28} />
          <Bar dataKey="breached" name={`✕ ${t.dashboard.breached}`} stackId="a" fill={CRITICAL} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

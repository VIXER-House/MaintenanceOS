"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Mail, MessageCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/page-header";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CH = { IN_APP: Bell, WHATSAPP: MessageCircle, SMS: Smartphone, EMAIL: Mail } as const;

export function NotificationsView({ items }: { items: { id: string; title: string; body: string; link: string | null; channel: keyof typeof CH; readAt: string | null; createdAt: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  async function markAll() {
    await api("/api/notifications/read", { body: {} });
    router.refresh();
  }
  async function open(id: string, link: string | null) {
    await api("/api/notifications/read", { body: { ids: [id] } }).catch(() => null);
    if (link) router.push(link);
    else router.refresh();
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t.notifications.title} subtitle={t.notifications.subtitle} actions={<Button variant="outline" onClick={markAll}><CheckCheck /> {t.notifications.markAll}</Button>} />
      <Card className="divide-y">
        {items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t.notifications.empty}</p>}
        {items.map((n) => {
          const Icon = CH[n.channel] ?? Bell;
          return (
            <button key={n.id} onClick={() => open(n.id, n.link)} className={cn("flex w-full items-start gap-3 p-4 text-start hover:bg-muted/50", !n.readAt && "bg-accent/40")}>
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", n.readAt ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground" suppressHydrationWarning>{relativeTime(n.createdAt, locale)}</span>
              {!n.readAt && <span className="mt-2 h-2 w-2 rounded-full bg-primary" />}
            </button>
          );
        })}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Delivered by <Link href="/settings" className="underline">MockNotificationProvider</Link>.</p>
    </div>
  );
}

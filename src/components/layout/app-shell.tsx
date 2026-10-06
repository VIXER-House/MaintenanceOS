"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bell, Boxes, Building, ClipboardList, Cog, HardHat, Languages, LayoutDashboard, LogOut, Menu, MessageCircle,
  PlayCircle, Truck, Users, Wrench, X, Inbox, FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, useSetLocale } from "@/lib/i18n/client";
import type { SessionUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

type NavItem = { href: string; label: string; icon: React.ElementType; roles?: SessionUser["role"][] };
const MANAGERS: SessionUser["role"][] = ["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"];

export function AppShell({
  user,
  unread,
  compound,
  children,
}: {
  user: SessionUser;
  unread: number;
  compound: { name: string; nameAr: string | null } | null;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const setLocale = useSetLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: t.nav.operations,
      items: [
        { href: "/", label: t.nav.dashboard, icon: LayoutDashboard, roles: MANAGERS },
        { href: "/my-jobs", label: t.nav.myJobs, icon: HardHat, roles: ["TECHNICIAN", "CONTRACTOR"] },
        { href: "/my-requests", label: t.nav.myRequests, icon: Inbox, roles: ["RESIDENT"] },
        { href: "/tickets", label: t.nav.tickets, icon: ClipboardList, roles: [...MANAGERS, "TECHNICIAN", "CONTRACTOR"] },
        { href: "/whatsapp", label: t.nav.whatsapp, icon: MessageCircle, roles: MANAGERS },
        { href: "/demo", label: t.nav.demo, icon: PlayCircle, roles: MANAGERS },
      ],
    },
    {
      title: t.nav.resources,
      items: [
        { href: "/technicians", label: t.nav.technicians, icon: Wrench, roles: MANAGERS },
        { href: "/contractors", label: t.nav.contractors, icon: Truck, roles: MANAGERS },
        { href: "/assets", label: t.nav.assets, icon: Boxes, roles: [...MANAGERS, "TECHNICIAN"] },
        { href: "/residents", label: t.nav.residents, icon: Users, roles: MANAGERS },
      ],
    },
    {
      title: t.nav.system,
      items: [
        { href: "/notifications", label: t.nav.notifications, icon: Bell },
        { href: "/import", label: t.nav.import, icon: FileSpreadsheet, roles: MANAGERS },
        { href: "/settings", label: t.nav.settings, icon: Cog, roles: MANAGERS },
      ],
    },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const displayName = locale === "ar" ? user.nameAr ?? user.name : user.name;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary"><Wrench className="h-4 w-4 text-white" /></span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">MaintenanceOS</div>
          <div className="flex items-center gap-1 text-[11px] text-sidebar-muted">
            <Building className="h-3 w-3" /> {locale === "ar" ? compound?.nameAr ?? compound?.name : compound?.name}
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {groups.map((g) => {
          const items = g.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">{g.title}</div>
              {items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    isActive(i.href) ? "bg-white/10 font-medium text-white" : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <i.icon className="h-4 w-4" />
                  <span className="flex-1">{i.label}</span>
                  {i.href === "/notifications" && unread > 0 && (
                    <span className="num rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{unread}</span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold">
            {displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium">{displayName}</div>
            <div className="truncate text-[11px] text-sidebar-muted">{t.roles[user.role]}</div>
          </div>
          <button onClick={logout} className="rounded p-1.5 text-sidebar-muted hover:bg-white/10 hover:text-white" title={t.nav.logout}>
            <LogOut className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-64">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <button className="rounded p-1.5 hover:bg-muted lg:hidden" onClick={() => setOpen(true)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
            <Languages /> {t.common.language}
          </Button>
          <Link href="/notifications" className="relative rounded-md p-2 hover:bg-muted">
            <Bell className="h-4 w-4" />
            {unread > 0 && <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

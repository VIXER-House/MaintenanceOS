import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [unread, compound] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.compound.findFirst({ select: { name: true, nameAr: true } }),
  ]);
  return (
    <AppShell user={user} unread={unread} compound={compound}>
      {children}
    </AppShell>
  );
}

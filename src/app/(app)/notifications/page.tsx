import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NotificationsView } from "@/features/notifications/notifications-view";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <NotificationsView
      items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, channel: n.channel, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))}
    />
  );
}

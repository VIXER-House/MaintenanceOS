import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/server/http/api";

export const GET = route(async () => {
  const { user } = await requireApiUser();
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { unread, items };
});

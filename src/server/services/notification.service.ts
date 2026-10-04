import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getNotificationProviders } from "@/server/providers/notifications";

export interface NotifyPayload {
  title: string;
  body: string;
  link?: string | null;
  ticketId?: string | null;
}

/** Send a notification to specific users across all configured channels. Never throws. */
export async function notifyUsers(userIds: (string | null | undefined)[], payload: NotifyPayload) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  try {
    const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, role: true, phone: true, email: true } });
    const providers = getNotificationProviders();
    await Promise.all(
      users.flatMap((u) =>
        providers.map((p) => p.send({ userId: u.id, role: u.role, phone: u.phone, email: u.email, ...payload })),
      ),
    );
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

/** Fan out to every active user holding one of the roles. */
export async function notifyRoles(roles: Role[], payload: NotifyPayload) {
  try {
    const users = await db.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
    await notifyUsers(
      users.map((u) => u.id),
      payload,
    );
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

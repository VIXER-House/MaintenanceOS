import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";

const Body = z.object({ ids: z.array(z.string()).optional() });

export const POST = route(async (req) => {
  const { user } = await requireApiUser();
  const { ids } = await parseBody(req, Body);
  const r = await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return { updated: r.count };
});

import { db } from "@/lib/db";
import { route } from "@/server/http/api";
import { requireBridge } from "@/server/http/bridge-auth";

/**
 * Replies waiting to be delivered by the bridge. Messages are claimed atomically
 * (QUEUED → SENT) so two polls never deliver the same message twice; the bridge
 * reports failures back via /ack.
 */
export const GET = route(async (req) => {
  requireBridge(req);
  const queued = await db.ticketMessage.findMany({
    where: { direction: "OUTBOUND", provider: "bridge", status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: { conversation: { select: { phone: true } } },
  });
  // Claim each message individually so overlapping polls never deliver (or drop) a message
  const messages: { id: string; to: string; body: string }[] = [];
  for (const m of queued) {
    const claimed = await db.ticketMessage.updateMany({ where: { id: m.id, status: "QUEUED" }, data: { status: "SENT" } });
    if (claimed.count === 1 && m.conversation?.phone) messages.push({ id: m.id, to: m.conversation.phone, body: m.body });
  }
  return { messages };
});

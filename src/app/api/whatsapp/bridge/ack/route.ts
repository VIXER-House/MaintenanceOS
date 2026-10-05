import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { requireBridge } from "@/server/http/bridge-auth";

const Body = z.object({ results: z.array(z.object({ id: z.string(), ok: z.boolean(), providerMessageId: z.string().optional(), error: z.string().optional() })).max(50) });

/** Delivery results from the bridge. */
export const POST = route(async (req) => {
  requireBridge(req);
  const { results } = await parseBody(req, Body);
  for (const r of results) {
    await db.ticketMessage.update({
      where: { id: r.id },
      data: r.ok ? { status: "DELIVERED", providerMessageId: r.providerMessageId } : { status: "FAILED", error: r.error?.slice(0, 500) ?? "send failed" },
    }).catch(() => null);
  }
  return { ok: true };
});

import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { requireBridge } from "@/server/http/bridge-auth";

const Body = z.object({
  status: z.enum(["starting", "qr", "connecting", "connected", "logged_out", "error"]),
  qr: z.string().max(2000).nullish(),
  phone: z.string().max(40).nullish(),
  error: z.string().max(500).nullish(),
});

/** Heartbeat from the bridge: current state + QR to scan. Answers whether a manager asked to unlink. */
export const POST = route(async (req) => {
  requireBridge(req);
  const b = await parseBody(req, Body);
  const data = {
    status: b.status,
    qr: b.status === "qr" ? (b.qr ?? null) : null,
    phone: b.status === "connected" ? (b.phone ?? null) : b.status === "logged_out" ? null : undefined,
    error: b.error ?? null,
    lastSeenAt: new Date(),
  };
  const s = await db.whatsAppBridgeSession.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
  return { logoutRequested: s.logoutRequested };
});

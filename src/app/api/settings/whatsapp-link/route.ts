import QRCode from "qrcode";
import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { wakeBridge } from "@/server/providers/whatsapp/bridge.provider";

export const dynamic = "force-dynamic";

/** The bridge heartbeats every 5 min when idle (so the free database can sleep) — online if seen within 7 min. */
const ONLINE_MS = 7 * 60_000;

export const GET = route(async () => {
  await requireApiUser(MANAGERS);
  const s = await db.whatsAppBridgeSession.findUnique({ where: { id: "default" } });
  if (!s) return { status: "never_connected", online: false, qrDataUrl: null, phone: null, lastSeenAt: null, error: null, logoutRequested: false };
  const online = Date.now() - s.lastSeenAt.getTime() < ONLINE_MS;
  const qrDataUrl = online && s.status === "qr" && s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 280 }) : null;
  return {
    status: online ? s.status : "offline",
    online,
    qrDataUrl,
    phone: s.phone,
    lastSeenAt: s.lastSeenAt.toISOString(),
    error: s.error,
    logoutRequested: s.logoutRequested,
  };
});

const Body = z.object({ action: z.literal("unlink") });

/** Manager asks the bridge to unlink the WhatsApp number (a new QR appears afterwards). */
export const POST = route(async (req) => {
  await requireApiUser(MANAGERS);
  await parseBody(req, Body);
  await db.whatsAppBridgeSession.upsert({
    where: { id: "default" },
    update: { logoutRequested: true },
    create: { id: "default", status: "offline", logoutRequested: true, lastSeenAt: new Date(0) },
  });
  await wakeBridge();
  return { ok: true };
});

import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { AppError, UnauthorizedError } from "@/server/services/errors";

/** The WhatsApp bridge authenticates with a shared secret header. */
export function requireBridge(req: NextRequest) {
  const secret = getConfig().WHATSAPP_BRIDGE_SECRET;
  if (!secret) throw new AppError("WHATSAPP_BRIDGE_SECRET is not configured on the server", 503, "NOT_CONFIGURED");
  const got = req.headers.get("x-bridge-secret") ?? "";
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();
}

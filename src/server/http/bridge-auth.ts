import type { NextRequest } from "next/server";
import { verifySharedSecret } from "@vixer-house/whatsapp-kit";
import { getConfig } from "@/lib/config";
import { AppError, UnauthorizedError } from "@/server/services/errors";

/** The WhatsApp bridge authenticates with a shared secret header. */
export function requireBridge(req: NextRequest) {
  const secret = getConfig().WHATSAPP_BRIDGE_SECRET;
  if (!secret) throw new AppError("WHATSAPP_BRIDGE_SECRET is not configured on the server", 503, "NOT_CONFIGURED");
  if (!verifySharedSecret(req.headers.get("x-bridge-secret"), secret)) throw new UnauthorizedError();
}

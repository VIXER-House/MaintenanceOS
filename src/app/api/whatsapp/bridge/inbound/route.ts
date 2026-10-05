import { route } from "@/server/http/api";
import { requireBridge } from "@/server/http/bridge-auth";
import { BridgeWhatsAppProvider } from "@/server/providers/whatsapp/bridge.provider";
import { handleInboundMessage } from "@/server/services/intake.service";

export const maxDuration = 60;

/** A message received by the PC bridge → normal intake pipeline (AI, tickets, replies). */
export const POST = route(async (req) => {
  requireBridge(req);
  const [msg] = await new BridgeWhatsAppProvider().receiveMessage(await req.json());
  const result = await handleInboundMessage(msg, "bridge");
  return { action: result.action, ticketNumber: result.ticketNumber ?? null };
});

import { wakeBridge as wake } from "@vixer-house/whatsapp-kit";
import { getConfig } from "@/lib/config";

export { BridgeWhatsAppProvider, BridgeInboundSchema } from "@vixer-house/whatsapp-kit";

/** Nudge the cloud bridge (WHATSAPP_BRIDGE_URL) to send queued messages now. Best effort. */
export async function wakeBridge(): Promise<void> {
  const { WHATSAPP_BRIDGE_URL, WHATSAPP_BRIDGE_SECRET } = getConfig();
  await wake(WHATSAPP_BRIDGE_URL, WHATSAPP_BRIDGE_SECRET);
}

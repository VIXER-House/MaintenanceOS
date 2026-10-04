import { requireApiUser, MANAGERS } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { MockInboundSchema } from "@/server/providers/whatsapp/mock.provider";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";

/** Simulator entry point: same normalized pipeline as the public webhook. */
export const POST = route(async (req) => {
  await requireApiUser(MANAGERS);
  const payload = await parseBody(req, MockInboundSchema);
  const [msg] = await getMockWhatsAppProvider().receiveMessage(payload);
  return handleInboundMessage(msg, "mock");
});

import { after, NextResponse, type NextRequest } from "next/server";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { WaslaWhatsAppProvider } from "@/server/providers/whatsapp/wasla.provider";
import { handleInboundMessage } from "@/server/services/intake.service";

export const maxDuration = 60;

/**
 * Incoming WhatsApp messages forwarded by the Wasla platform.
 * Set this URL as the webhook in Wasla → Dashboard → WhatsApp, and its signing secret as WASLA_WEBHOOK_SECRET.
 * We answer right away and process after the response, so Wasla's forwarding never times out.
 */
export async function POST(req: NextRequest) {
  const provider = getWhatsAppProvider();
  if (!(provider instanceof WaslaWhatsAppProvider)) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Set WHATSAPP_PROVIDER=wasla, WASLA_API_URL and WASLA_API_KEY" } }, { status: 503 });
  }
  const raw = await req.text();
  if (!provider.verifySignature(raw, req.headers.get("x-wasla-signature"))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Bad or missing signature (check WASLA_WEBHOOK_SECRET)" } }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Body must be JSON" } }, { status: 400 });
  }
  const messages = await provider.receiveMessage(payload);
  after(async () => {
    for (const m of messages) {
      const started = Date.now();
      try {
        const r = await handleInboundMessage(m, provider.name);
        console.log(`[wasla] message from ${m.from} handled in ${Date.now() - started}ms → ${r.action}${r.ticketNumber ? ` ${r.ticketNumber}` : ""}`);
      } catch (e) {
        console.error("[wasla] inbound failed", e);
      }
    }
  });
  return NextResponse.json({ ok: true, received: messages.length });
}

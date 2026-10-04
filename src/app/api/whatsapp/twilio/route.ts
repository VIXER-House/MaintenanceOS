import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { TwilioWhatsAppProvider } from "@/server/providers/whatsapp/twilio.provider";
import { handleInboundMessage } from "@/server/services/intake.service";

export const maxDuration = 60;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * Twilio WhatsApp webhook ("When a message comes in" → POST this URL).
 * Replies are sent asynchronously via the REST API, so we answer with empty TwiML.
 */
export async function POST(req: NextRequest) {
  const provider = getWhatsAppProvider();
  if (!(provider instanceof TwilioWhatsAppProvider)) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Set WHATSAPP_PROVIDER=twilio" } }, { status: 503 });
  }
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

  if (getConfig().TWILIO_VALIDATE_SIGNATURE) {
    const url = `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host")}${req.nextUrl.pathname}`;
    if (!provider.verifySignature(url, params, req.headers.get("x-twilio-signature"))) {
      return new NextResponse("Bad signature", { status: 403 });
    }
  }

  try {
    for (const m of await provider.receiveMessage(params)) await handleInboundMessage(m, provider.name);
  } catch (e) {
    console.error("[twilio] inbound failed", e);
  }
  return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}

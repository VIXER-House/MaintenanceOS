import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { errorResponse } from "@/server/http/api";
import { getMockWhatsAppProvider, getWhatsAppProvider } from "@/server/providers/whatsapp";
import { MetaWhatsAppProvider } from "@/server/providers/whatsapp/meta.provider";
import { handleInboundMessage } from "@/server/services/intake.service";

/**
 * WhatsApp webhook.
 * GET  — Meta verification handshake (hub.mode / hub.verify_token / hub.challenge)
 * POST — inbound messages. Meta Cloud API payloads are always accepted (signature
 *        checked when WHATSAPP_APP_SECRET is set). The simple mock payload
 *        ({ from, text, ... }) is accepted only outside production / in mock mode.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === getConfig().WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: { code: "FORBIDDEN", message: "Verification failed" } }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const payload = raw ? JSON.parse(raw) : {};
    const cfg = getConfig();

    if (payload?.object === "whatsapp_business_account") {
      const provider = getWhatsAppProvider();
      if (provider instanceof MetaWhatsAppProvider && !provider.verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
        return NextResponse.json({ error: { code: "FORBIDDEN", message: "Bad signature" } }, { status: 403 });
      }
      const messages = await (provider instanceof MetaWhatsAppProvider ? provider : new MetaWhatsAppProvider({ token: "", phoneNumberId: "", apiVersion: cfg.WHATSAPP_API_VERSION })).receiveMessage(payload);
      const results = [];
      for (const m of messages) results.push(await handleInboundMessage(m, provider.name));
      // Always 200 quickly so Meta does not retry
      return NextResponse.json({ ok: true, processed: results.length });
    }

    if (cfg.NODE_ENV === "production" && cfg.WHATSAPP_PROVIDER !== "mock") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Mock payloads disabled" } }, { status: 403 });
    }
    const [msg] = await getMockWhatsAppProvider().receiveMessage(payload);
    const result = await handleInboundMessage(msg, "mock");
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

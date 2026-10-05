import { getConfig } from "@/lib/config";
import { MetaWhatsAppProvider } from "./meta.provider";
import { MockWhatsAppProvider } from "./mock.provider";
import { TwilioWhatsAppProvider } from "./twilio.provider";
import { BridgeWhatsAppProvider } from "./bridge.provider";
import type { WhatsAppProvider } from "./types";

export * from "./types";

let instance: WhatsAppProvider | null = null;
const mock = new MockWhatsAppProvider();

export function getWhatsAppProvider(): WhatsAppProvider {
  if (instance) return instance;
  const c = getConfig();
  if (c.WHATSAPP_PROVIDER === "bridge" && c.WHATSAPP_BRIDGE_SECRET) {
    instance = new BridgeWhatsAppProvider();
  } else if (c.WHATSAPP_PROVIDER === "twilio" && c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN) {
    instance = new TwilioWhatsAppProvider({ accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, from: c.TWILIO_WHATSAPP_FROM });
  } else if (c.WHATSAPP_PROVIDER === "meta" && c.WHATSAPP_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID) {
    instance = new MetaWhatsAppProvider({
      token: c.WHATSAPP_TOKEN,
      phoneNumberId: c.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: c.WHATSAPP_API_VERSION,
      appSecret: c.WHATSAPP_APP_SECRET,
    });
  } else {
    if (c.WHATSAPP_PROVIDER !== "mock") console.warn(`[whatsapp] ${c.WHATSAPP_PROVIDER} selected but credentials missing — using mock`);
    instance = mock;
  }
  return instance;
}

/** The simulator always speaks the mock wire format, even when Meta is configured for real numbers. */
export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  return mock;
}

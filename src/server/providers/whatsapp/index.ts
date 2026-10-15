import { createWhatsAppProvider, MockWhatsAppProvider, type ProviderConfig, type WhatsAppProvider } from "@vixer-house/whatsapp-kit";
import { getConfig } from "@/lib/config";
import { WaslaWhatsAppProvider } from "./wasla.provider";

export * from "./types";

/**
 * App-side wiring: reads env config and builds a provider from packages/whatsapp-kit.
 * Everything WhatsApp-specific (wire formats, signatures, sending) lives in the library.
 */
let instance: WhatsAppProvider | null = null;
const mock = new MockWhatsAppProvider({ log: process.env.NODE_ENV !== "test" });

function providerConfigFromEnv(): ProviderConfig | null {
  const c = getConfig();
  if (c.WHATSAPP_PROVIDER === "bridge" && c.WHATSAPP_BRIDGE_SECRET) return { provider: "bridge" };
  if (c.WHATSAPP_PROVIDER === "twilio" && c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN) {
    return { provider: "twilio", twilio: { accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, from: c.TWILIO_WHATSAPP_FROM } };
  }
  if (c.WHATSAPP_PROVIDER === "meta" && c.WHATSAPP_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID) {
    return { provider: "meta", meta: { token: c.WHATSAPP_TOKEN, phoneNumberId: c.WHATSAPP_PHONE_NUMBER_ID, apiVersion: c.WHATSAPP_API_VERSION, appSecret: c.WHATSAPP_APP_SECRET } };
  }
  if (c.WHATSAPP_PROVIDER !== "mock") console.warn(`[whatsapp] ${c.WHATSAPP_PROVIDER} selected but credentials missing — using mock`);
  return null;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  if (instance) return instance;
  const c = getConfig();
  if (c.WHATSAPP_PROVIDER === "wasla" && c.WASLA_API_URL && c.WASLA_API_KEY) {
    instance = new WaslaWhatsAppProvider({ apiUrl: c.WASLA_API_URL, apiKey: c.WASLA_API_KEY, webhookSecret: c.WASLA_WEBHOOK_SECRET });
    return instance;
  }
  const cfg = providerConfigFromEnv();
  instance = cfg ? createWhatsAppProvider(cfg) : mock;
  return instance;
}

/** The simulator always speaks the mock wire format, even when a real provider is configured. */
export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  return mock;
}

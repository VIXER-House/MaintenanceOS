import { getConfig } from "@/lib/config";
import { MetaWhatsAppProvider } from "./meta.provider";
import { MockWhatsAppProvider } from "./mock.provider";
import type { WhatsAppProvider } from "./types";

export * from "./types";

let instance: WhatsAppProvider | null = null;
const mock = new MockWhatsAppProvider();

export function getWhatsAppProvider(): WhatsAppProvider {
  if (instance) return instance;
  const c = getConfig();
  if (c.WHATSAPP_PROVIDER === "meta" && c.WHATSAPP_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID) {
    instance = new MetaWhatsAppProvider({
      token: c.WHATSAPP_TOKEN,
      phoneNumberId: c.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: c.WHATSAPP_API_VERSION,
      appSecret: c.WHATSAPP_APP_SECRET,
    });
  } else {
    if (c.WHATSAPP_PROVIDER === "meta") console.warn("[whatsapp] meta selected but WHATSAPP_TOKEN/PHONE_NUMBER_ID missing — using mock");
    instance = mock;
  }
  return instance;
}

/** The simulator always speaks the mock wire format, even when Meta is configured for real numbers. */
export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  return mock;
}

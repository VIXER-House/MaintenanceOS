import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { route } from "@/server/http/api";
import { getAIProvider } from "@/server/providers/ai";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { getSpeechProvider } from "@/server/providers/speech";
import { getVisionProvider } from "@/server/providers/vision";

export const GET = route(async () => {
  let database = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }
  return {
    status: database === "ok" ? "ok" : "degraded",
    database,
    providers: {
      ai: `${getAIProvider().name}${getAIProvider().model ? `:${getAIProvider().model}` : ""}`,
      whatsapp: getWhatsAppProvider().name,
      speech: getSpeechProvider().name,
      vision: getVisionProvider().name,
      notifications: getConfig().NOTIFICATION_CHANNELS,
    },
  };
});

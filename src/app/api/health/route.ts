import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { route } from "@/server/http/api";
import { ensureDatabaseReady } from "@/server/services/bootstrap.service";

export const maxDuration = 60;
import { getAIProvider } from "@/server/providers/ai";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { getSpeechProvider } from "@/server/providers/speech";
import { getVisionProvider } from "@/server/providers/vision";

export const GET = route(async () => {
  let database = "ok";
  let detail: string | null = null;
  let users: number | null = null;
  try {
    await ensureDatabaseReady();
    users = await db.user.count();
  } catch (e) {
    database = "error";
    // Never echo credentials
    detail = String((e as Error).message ?? e).replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***").slice(0, 300);
  }
  return {
    status: database === "ok" ? "ok" : "degraded",
    database,
    detail,
    users,
    providers: {
      ai: `${getAIProvider().name}${getAIProvider().model ? `:${getAIProvider().model}` : ""}`,
      whatsapp: getWhatsAppProvider().name,
      speech: getSpeechProvider().name,
      vision: getVisionProvider().name,
      notifications: getConfig().NOTIFICATION_CHANNELS,
    },
  };
});

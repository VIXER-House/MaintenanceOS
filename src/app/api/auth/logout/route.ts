import { endSession } from "@/lib/auth";
import { route } from "@/server/http/api";

export const POST = route(async () => {
  await endSession();
  return { ok: true };
});

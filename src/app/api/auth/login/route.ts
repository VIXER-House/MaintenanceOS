import { z } from "zod";
import { authenticate, homeFor, startSession } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { AppError } from "@/server/services/errors";
import { ensureDatabaseReady } from "@/server/services/bootstrap.service";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export const maxDuration = 60;

export const POST = route(async (req) => {
  await ensureDatabaseReady();
  const { email, password } = await parseBody(req, Body);
  const user = await authenticate(email, password);
  if (!user) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  await startSession(user);
  return { user, redirectTo: homeFor(user.role) };
});

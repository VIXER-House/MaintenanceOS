import { z } from "zod";
import { requireApiUser, MANAGERS } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { DEMO_STEPS, runDemoStep } from "@/server/services/demo.service";

const Body = z.object({ step: z.enum(DEMO_STEPS), ticketId: z.string().optional().nullable() });

export const POST = route(async (req) => {
  await requireApiUser(MANAGERS);
  const { step, ticketId } = await parseBody(req, Body);
  return runDemoStep(step, ticketId);
});

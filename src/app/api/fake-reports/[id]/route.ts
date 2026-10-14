import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { resolveFakeReport } from "@/server/services/fake-report.service";

/** Manager review of a fake report — POST /api/fake-reports/:id { decision, note } */
const schema = z.object({
  decision: z.enum(["confirm", "confirm_block", "dismiss"]),
  note: z.string().max(500).optional().nullable(),
});

export const POST = route(async (req, { id }) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, schema);
  return { ok: true, ...(await resolveFakeReport(id, body.decision, actor, body.note)) };
});

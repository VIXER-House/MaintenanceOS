import { z } from "zod";
import { requireApiUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBody, route } from "@/server/http/api";
import { listTickets } from "@/server/services/query.service";
import { createAndTriageTicket } from "@/server/services/ticket.service";
import { sweepSlaBreaches } from "@/server/services/sla.service";
import { NotFoundError } from "@/server/services/errors";
import { CATEGORY_KEYS, PRIORITIES } from "@/server/domain/constants";

export const GET = route(async (req) => {
  const { user } = await requireApiUser();
  await sweepSlaBreaches();
  const p = req.nextUrl.searchParams;
  return listTickets(user, {
    status: p.get("status") ?? undefined,
    priority: p.get("priority") ?? undefined,
    category: p.get("category") ?? undefined,
    q: p.get("q") ?? undefined,
    technicianId: p.get("technicianId") ?? undefined,
    sla: (p.get("sla") as "breached") ?? undefined,
    page: Number(p.get("page") ?? 1),
    pageSize: Number(p.get("pageSize") ?? 25),
  });
});

const CreateTicket = z.object({
  description: z.string().trim().min(3).max(2000),
  residentId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  categoryKey: z.enum(CATEGORY_KEYS).optional().nullable(),
  priority: z.enum(PRIORITIES).optional().nullable(),
  source: z.enum(["WEB", "PHONE"]).default("WEB"),
});

/** Manual ticket creation (fallback channel). AI triage still runs; manager overrides win. */
export const POST = route(async (req) => {
  const { actor } = await requireApiUser(MANAGERS);
  const body = await parseBody(req, CreateTicket);
  if (body.residentId && !(await db.resident.findUnique({ where: { id: body.residentId } }))) throw new NotFoundError("Resident");
  const r = await createAndTriageTicket({
    text: body.description,
    source: body.source,
    residentId: body.residentId,
    unitId: body.unitId,
    actor,
    allowFollowUp: false,
    overrides: { categoryKey: body.categoryKey, priority: body.priority },
  });
  return { id: r.ticket.id, ticketNumber: r.ticket.ticketNumber, status: r.ticket.status, priority: r.ticket.priority, assignment: r.assignment };
});

import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { parseBody, route } from "@/server/http/api";
import { AppError } from "@/server/services/errors";
import { CATEGORY_KEYS, PRIORITIES } from "@/server/domain/constants";
import * as tickets from "@/server/services/ticket.service";

/**
 * Ticket lifecycle actions — POST /api/tickets/:id/:action
 *   assign · acknowledge · start · request-quotation · quotation · approve · reject
 *   revision · complete · close · cancel · reopen · priority · analysis · notes
 * Authorization is enforced again inside the services (defense in depth).
 */
const notes = z.object({ notes: z.string().max(1000).optional().nullable() });
const quoteRef = z.object({ quotationId: z.string().optional().nullable(), notes: z.string().max(1000).optional().nullable() });

const schemas = {
  assign: z
    .object({ technicianId: z.string().optional().nullable(), contractorId: z.string().optional().nullable() })
    .refine((v) => !!v.technicianId !== !!v.contractorId, "Choose exactly one technician or contractor"),
  acknowledge: z.object({}),
  start: z.object({}),
  "request-quotation": notes,
  quotation: z.object({
    items: z
      .array(
        z.object({
          type: z.enum(["LABOR", "MATERIAL"]),
          description: z.string().trim().min(1).max(200),
          quantity: z.coerce.number().positive(),
          unitPrice: z.coerce.number().min(0),
        }),
      )
      .min(1)
      .max(30),
    vatRate: z.coerce.number().min(0).max(1).optional(),
    estimatedHours: z.coerce.number().positive().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  }),
  approve: quoteRef,
  reject: quoteRef,
  revision: quoteRef,
  complete: z.object({ notes: z.string().max(1000).optional().nullable(), finalCost: z.coerce.number().min(0).optional().nullable() }),
  close: notes,
  cancel: notes,
  reopen: notes,
  priority: z.object({ priority: z.enum(PRIORITIES), reason: z.string().max(500).optional().nullable() }),
  analysis: z.object({
    categoryKey: z.enum(CATEGORY_KEYS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    title: z.string().trim().min(3).max(120).optional(),
    location: z.string().max(80).optional().nullable(),
    assetId: z.string().optional().nullable(),
    recommendedAction: z.string().max(200).optional().nullable(),
  }),
  notes: z.object({ note: z.string().trim().min(1).max(1000) }),
} as const;

type Action = keyof typeof schemas;

export const POST = route(async (req, { id, action }) => {
  if (!(action in schemas)) throw new AppError(`Unknown action "${action}"`, 404, "NOT_FOUND");
  const { actor } = await requireApiUser();
  const a = action as Action;
  // Each body was validated by its action's Zod schema above
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await parseBody(req, schemas[a])) as any;
  let result: unknown;
  switch (a) {
    case "assign": result = await tickets.assignTicket(id, body, actor); break;
    case "acknowledge": result = await tickets.acknowledgeTicket(id, actor); break;
    case "start": result = await tickets.startTicket(id, actor); break;
    case "request-quotation": result = await tickets.requestQuotation(id, actor, body.notes ?? undefined); break;
    case "quotation": result = (await tickets.submitQuotation(id, body, actor)).ticket; break;
    case "approve": result = await tickets.approveQuotation(id, actor, body); break;
    case "reject": result = await tickets.rejectQuotation(id, actor, body); break;
    case "revision": result = await tickets.requestQuotationRevision(id, actor, body); break;
    case "complete": result = await tickets.completeTicket(id, actor, body); break;
    case "close": result = await tickets.closeTicket(id, actor, body.notes); break;
    case "cancel": result = await tickets.cancelTicket(id, actor, body.notes); break;
    case "reopen": result = await tickets.reopenTicket(id, actor, body.notes); break;
    case "priority": result = await tickets.changePriority(id, body.priority, actor, body.reason); break;
    case "analysis": result = await tickets.editAnalysis(id, body, actor); break;
    case "notes": await tickets.addNote(id, body.note, actor); result = { ok: true }; break;
  }
  const t = result as { id?: string; status?: string; ticketNumber?: string };
  return { ok: true, id: t?.id ?? id, status: t?.status, ticketNumber: t?.ticketNumber };
});

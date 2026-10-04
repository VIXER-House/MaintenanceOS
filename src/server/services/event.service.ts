import type { Prisma, TicketEventType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "./actor";

/** Append an audit-log entry to a ticket's timeline. */
export async function recordEvent(
  ticketId: string,
  type: TicketEventType,
  actor: Actor,
  message: string,
  data?: Prisma.InputJsonValue,
  tx: Tx = db,
) {
  return tx.ticketEvent.create({
    data: {
      ticketId,
      type,
      actorType: actor.type,
      actorId: actor.userId ?? null,
      actorName: actor.name,
      message,
      data: data ?? undefined,
    },
  });
}

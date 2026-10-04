import type { ActorType, Role } from "@prisma/client";

/** Who is performing an action — recorded on every TicketEvent (audit log). */
export interface Actor {
  type: ActorType;
  name: string;
  userId?: string | null;
  role?: Role | null;
  technicianId?: string | null;
  contractorId?: string | null;
  residentId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", name: "MaintenanceOS" };
export const AI_ACTOR: Actor = { type: "AI", name: "AI Assistant" };

export function actorFromUser(user: {
  id: string;
  name: string;
  role: Role;
  technicianId?: string | null;
  contractorId?: string | null;
  residentId?: string | null;
}): Actor {
  const type: ActorType =
    user.role === "TECHNICIAN" ? "TECHNICIAN" : user.role === "CONTRACTOR" ? "CONTRACTOR" : user.role === "RESIDENT" ? "RESIDENT" : "STAFF";
  return {
    type,
    name: user.name,
    userId: user.id,
    role: user.role,
    technicianId: user.technicianId ?? null,
    contractorId: user.contractorId ?? null,
    residentId: user.residentId ?? null,
  };
}

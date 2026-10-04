/**
 * Domain constants shared by engines, services and UI.
 * These intentionally mirror the Prisma enums as string unions so that the pure
 * engines (priority / SLA / assignment / lifecycle) have zero runtime dependency
 * on Prisma and can be unit-tested in isolation.
 */

export const PRIORITIES = ["EMERGENCY", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Higher number = more urgent */
export const PRIORITY_RANK: Record<Priority, number> = {
  EMERGENCY: 5,
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function priorityFromRank(rank: number): Priority {
  const clamped = Math.max(1, Math.min(5, Math.round(rank)));
  return (Object.keys(PRIORITY_RANK) as Priority[]).find((p) => PRIORITY_RANK[p] === clamped)!;
}

export function maxPriority(...ps: (Priority | null | undefined)[]): Priority | null {
  const valid = ps.filter(Boolean) as Priority[];
  if (!valid.length) return null;
  return valid.reduce((a, b) => (PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a));
}

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

export const TICKET_STATUSES = [
  "NEW",
  "AI_ANALYZING",
  "WAITING_FOR_INFO",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_QUOTATION",
  "WAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses in which a ticket is considered "open" (work outstanding). */
export const OPEN_STATUSES: TicketStatus[] = [
  "NEW",
  "AI_ANALYZING",
  "WAITING_FOR_INFO",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_QUOTATION",
  "WAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
];

/** Statuses that count against a technician's workload. */
export const ACTIVE_WORK_STATUSES: TicketStatus[] = [
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_QUOTATION",
  "WAITING_APPROVAL",
  "APPROVED",
];

export const CATEGORY_KEYS = [
  "PLUMBING",
  "ELECTRICAL",
  "HVAC",
  "ELEVATOR",
  "CIVIL",
  "PAINTING",
  "CARPENTRY",
  "APPLIANCES",
  "SECURITY",
  "CLEANING",
  "LANDSCAPING",
  "OTHER",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export function isCategoryKey(v: unknown): v is CategoryKey {
  return typeof v === "string" && (CATEGORY_KEYS as readonly string[]).includes(v);
}

export const ROLES = [
  "ADMIN",
  "COMPOUND_MANAGER",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN",
  "CONTRACTOR",
  "RESIDENT",
] as const;
export type Role = (typeof ROLES)[number];

export const MANAGER_ROLES: Role[] = ["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"];
export const FIELD_ROLES: Role[] = ["TECHNICIAN", "CONTRACTOR"];

export function isManager(role: string): boolean {
  return (MANAGER_ROLES as string[]).includes(role);
}

/** Egyptian VAT */
export const DEFAULT_VAT_RATE = 0.14;

export const TICKET_NUMBER_PREFIX = "MAINT-";
export function formatTicketNumber(n: number): string {
  return `${TICKET_NUMBER_PREFIX}${String(n).padStart(6, "0")}`;
}

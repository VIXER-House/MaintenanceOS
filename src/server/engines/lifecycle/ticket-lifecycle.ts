import { isManager, type Role, type TicketStatus } from "@/server/domain/constants";

/**
 * Ticket state machine. Every status change in the system goes through
 * `assertTransition` so illegal jumps (e.g. NEW → CLOSED) are impossible.
 */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["AI_ANALYZING", "WAITING_FOR_INFO", "ASSIGNED", "CANCELLED"],
  AI_ANALYZING: ["NEW", "WAITING_FOR_INFO", "ASSIGNED", "CANCELLED"],
  WAITING_FOR_INFO: ["AI_ANALYZING", "NEW", "ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACKNOWLEDGED", "NEW", "CANCELLED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "WAITING_QUOTATION", "ASSIGNED", "NEW", "CANCELLED"],
  IN_PROGRESS: ["WAITING_QUOTATION", "WAITING_APPROVAL", "COMPLETED", "ASSIGNED", "NEW", "CANCELLED"],
  WAITING_QUOTATION: ["WAITING_APPROVAL", "IN_PROGRESS", "CANCELLED"],
  WAITING_APPROVAL: ["APPROVED", "REJECTED", "WAITING_QUOTATION"],
  APPROVED: ["IN_PROGRESS", "CANCELLED"],
  REJECTED: ["WAITING_QUOTATION", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(
    public from: TicketStatus,
    public to: TicketStatus,
  ) {
    super(`Cannot move ticket from ${from} to ${to}`);
  }
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(status: TicketStatus): boolean {
  return status === "CLOSED" || status === "CANCELLED";
}

export type TicketAction =
  | "assign"
  | "acknowledge"
  | "start"
  | "requestQuotation"
  | "submitQuotation"
  | "approve"
  | "reject"
  | "requestRevision"
  | "complete"
  | "close"
  | "cancel"
  | "reopen"
  | "changePriority"
  | "decline";

/** Which status a given action moves the ticket to (null = status unchanged) */
export const ACTION_TARGET: Partial<Record<TicketAction, TicketStatus>> = {
  assign: "ASSIGNED",
  acknowledge: "ACKNOWLEDGED",
  start: "IN_PROGRESS",
  requestQuotation: "WAITING_QUOTATION",
  submitQuotation: "WAITING_APPROVAL",
  approve: "APPROVED",
  reject: "REJECTED",
  requestRevision: "WAITING_QUOTATION",
  complete: "COMPLETED",
  close: "CLOSED",
  cancel: "CANCELLED",
  reopen: "IN_PROGRESS",
};

const FIELD_ACTIONS: TicketAction[] = ["acknowledge", "start", "requestQuotation", "submitQuotation", "complete", "decline"];
const MANAGER_ONLY: TicketAction[] = ["assign", "approve", "reject", "requestRevision", "close", "cancel", "reopen", "changePriority"];

/**
 * Actions a role may take on a ticket in its current status.
 * Managers can do everything; technicians/contractors only field actions on their own jobs.
 * Financial decisions (approve/reject) are manager-only — the AI never performs them.
 */
export function availableActions(status: TicketStatus, role: Role, isAssignee = false): TicketAction[] {
  const manager = isManager(role);
  const out: TicketAction[] = [];
  const consider = (a: TicketAction, extra = true) => {
    if (!extra) return;
    if (MANAGER_ONLY.includes(a) && !manager) return;
    if (FIELD_ACTIONS.includes(a) && !manager && !isAssignee) return;
    if (role === "RESIDENT") return;
    out.push(a);
  };
  const can = (to: TicketStatus) => canTransition(status, to);

  // (Re)assignment is allowed in every non-terminal status except while a quote is under review.
  consider("assign", !isTerminal(status) && !["WAITING_APPROVAL", "COMPLETED"].includes(status));
  consider("acknowledge", can("ACKNOWLEDGED"));
  consider("start", can("IN_PROGRESS") && status !== "COMPLETED" && status !== "WAITING_QUOTATION");
  consider("requestQuotation", can("WAITING_QUOTATION") && status !== "WAITING_APPROVAL");
  consider("submitQuotation", ["IN_PROGRESS", "WAITING_QUOTATION", "ACKNOWLEDGED", "REJECTED"].includes(status));
  consider("approve", status === "WAITING_APPROVAL");
  consider("reject", status === "WAITING_APPROVAL");
  consider("requestRevision", status === "WAITING_APPROVAL");
  consider("complete", can("COMPLETED"));
  consider("close", can("CLOSED"));
  consider("reopen", status === "COMPLETED");
  consider("cancel", can("CANCELLED"));
  consider("changePriority", !isTerminal(status));
  // Only the assignee can say "I can't do this one" (managers reassign instead)
  consider("decline", isAssignee && ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"].includes(status));
  return out;
}

import { describe, expect, it } from "vitest";
import { assertTransition, availableActions, canTransition, InvalidTransitionError } from "@/server/engines/lifecycle/ticket-lifecycle";
import type { TicketStatus } from "@/server/domain/constants";

describe("ticket lifecycle state machine", () => {
  it("allows the happy path with quotation", () => {
    const path: TicketStatus[] = [
      "NEW", "AI_ANALYZING", "NEW", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_QUOTATION",
      "WAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED",
    ];
    for (let i = 1; i < path.length; i++) expect(() => assertTransition(path[i - 1], path[i])).not.toThrow();
  });

  it("supports the follow-up question loop", () => {
    expect(canTransition("AI_ANALYZING", "WAITING_FOR_INFO")).toBe(true);
    expect(canTransition("WAITING_FOR_INFO", "AI_ANALYZING")).toBe(true);
  });

  it.each([
    ["NEW", "CLOSED"],
    ["ASSIGNED", "COMPLETED"],
    ["WAITING_APPROVAL", "IN_PROGRESS"],
    ["WAITING_APPROVAL", "COMPLETED"],
    ["CLOSED", "IN_PROGRESS"],
    ["CANCELLED", "NEW"],
  ] as [TicketStatus, TicketStatus][])("rejects %s → %s", (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("restricts financial actions to managers", () => {
    expect(availableActions("WAITING_APPROVAL", "MAINTENANCE_MANAGER")).toEqual(expect.arrayContaining(["approve", "reject", "requestRevision"]));
    expect(availableActions("WAITING_APPROVAL", "TECHNICIAN", true)).not.toContain("approve");
  });

  it("only lets the assignee perform field actions", () => {
    expect(availableActions("ASSIGNED", "TECHNICIAN", true)).toContain("acknowledge");
    expect(availableActions("ASSIGNED", "TECHNICIAN", false)).not.toContain("acknowledge");
    expect(availableActions("IN_PROGRESS", "TECHNICIAN", true)).toEqual(expect.arrayContaining(["complete", "submitQuotation"]));
  });

  it("gives residents no back-office actions", () => {
    expect(availableActions("IN_PROGRESS", "RESIDENT", true)).toEqual([]);
  });
});

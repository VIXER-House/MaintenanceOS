import { describe, expect, it } from "vitest";
import { recommendAssignment, scoreTechnician, type TechnicianCandidate } from "@/server/engines/assignment/assignment-engine";

const tech = (o: Partial<TechnicianCandidate>): TechnicianCandidate => ({
  id: o.name ?? "t",
  name: "Tech",
  skills: ["PLUMBING"],
  status: "AVAILABLE",
  openTickets: 0,
  maxConcurrent: 5,
  ...o,
});

describe("assignment engine", () => {
  it("scores skill*50 + availability*30 + inverseWorkload*20", () => {
    expect(scoreTechnician(tech({ openTickets: 0 }), "PLUMBING").score).toBe(100);
    expect(scoreTechnician(tech({ status: "BUSY", openTickets: 1 }), "PLUMBING").score).toBe(50 + 15 + 16);
    expect(scoreTechnician(tech({ skills: ["GENERAL"] }), "PLUMBING").score).toBe(25 + 30 + 20);
  });

  it("excludes off-duty, unskilled and at-capacity technicians", () => {
    expect(scoreTechnician(tech({ status: "OFF_DUTY" }), "PLUMBING").eligible).toBe(false);
    expect(scoreTechnician(tech({ skills: ["HVAC"] }), "PLUMBING").eligible).toBe(false);
    expect(scoreTechnician(tech({ openTickets: 5 }), "PLUMBING").eligible).toBe(false);
  });

  it("picks the least-loaded available specialist", () => {
    const r = recommendAssignment({
      categoryKey: "PLUMBING",
      requiredSkill: "PLUMBING",
      technicians: [
        tech({ id: "a", name: "Ahmed", openTickets: 4 }),
        tech({ id: "b", name: "Mohamed", openTickets: 1 }),
        tech({ id: "c", name: "Omar", skills: ["HVAC"] }),
      ],
      contractors: [],
    });
    expect(r.strategy).toBe("TECHNICIAN");
    expect(r.technician?.technician.id).toBe("b");
  });

  it("recommends a contractor (not auto-assign) when no internal specialist is available", () => {
    const r = recommendAssignment({
      categoryKey: "ELEVATOR",
      requiredSkill: "ELEVATOR",
      technicians: [tech({ skills: ["GENERAL"] })],
      contractors: [
        { id: "x", name: "Lift Co", categoryKey: "ELEVATOR", rating: 4.6, isActive: true, avgResponseMinutes: 40, openTickets: 1 },
        { id: "y", name: "Inactive", categoryKey: "ELEVATOR", rating: 5, isActive: false, avgResponseMinutes: 10, openTickets: 0 },
      ],
    });
    expect(r.strategy).toBe("CONTRACTOR");
    expect(r.contractor?.contractor.id).toBe("x");
    expect(r.technician).toBeNull();
  });

  it("falls back to a generalist, then to NONE", () => {
    const r = recommendAssignment({ categoryKey: "PAINTING", requiredSkill: "PAINTING", technicians: [tech({ skills: ["GENERAL"] })], contractors: [] });
    expect(r.strategy).toBe("TECHNICIAN");
    const none = recommendAssignment({ categoryKey: "PAINTING", requiredSkill: "PAINTING", technicians: [], contractors: [] });
    expect(none.strategy).toBe("NONE");
  });
});

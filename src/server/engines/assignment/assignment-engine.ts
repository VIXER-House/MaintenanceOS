/**
 * Assignment engine — pure scoring, no I/O.
 *
 *   score = skillMatch * 50 + availability * 30 + inverseWorkload * 20
 *
 * Internal technicians are auto-assigned (operational decision).
 * Contractors are only ever RECOMMENDED: engaging an external contractor has cost
 * implications, so a manager must confirm (human-in-the-loop).
 */

export const ASSIGNMENT_WEIGHTS = { skill: 50, availability: 30, workload: 20 } as const;

export type TechnicianStatus = "AVAILABLE" | "BUSY" | "OFF_DUTY";

export interface TechnicianCandidate {
  id: string;
  name: string;
  skills: string[];
  status: TechnicianStatus;
  openTickets: number;
  maxConcurrent: number;
}

export interface ContractorCandidate {
  id: string;
  name: string;
  categoryKey: string | null;
  rating: number;
  isActive: boolean;
  avgResponseMinutes: number;
  openTickets: number;
}

export interface ScoredTechnician {
  technician: TechnicianCandidate;
  score: number;
  skillMatch: number;
  availability: number;
  inverseWorkload: number;
  eligible: boolean;
  reasons: string[];
}

export interface ScoredContractor {
  contractor: ContractorCandidate;
  score: number;
  eligible: boolean;
  reasons: string[];
}

export function scoreTechnician(t: TechnicianCandidate, requiredSkill: string): ScoredTechnician {
  const reasons: string[] = [];
  const skillMatch = t.skills.includes(requiredSkill) ? 1 : t.skills.includes("GENERAL") ? 0.5 : 0;
  const availability = t.status === "AVAILABLE" ? 1 : t.status === "BUSY" ? 0.5 : 0;
  const cap = Math.max(1, t.maxConcurrent);
  const inverseWorkload = Math.max(0, 1 - t.openTickets / cap);

  if (skillMatch === 0) reasons.push(`No ${requiredSkill} skill`);
  else if (skillMatch < 1) reasons.push("General handyman (partial skill match)");
  else reasons.push(`${requiredSkill} specialist`);
  if (availability === 0) reasons.push("Off duty");
  else if (availability < 1) reasons.push("Busy");
  if (t.openTickets >= cap) reasons.push(`At capacity (${t.openTickets}/${cap})`);
  else reasons.push(`Workload ${t.openTickets}/${cap}`);

  const eligible = skillMatch > 0 && availability > 0 && t.openTickets < cap;
  const score =
    Math.round(
      (skillMatch * ASSIGNMENT_WEIGHTS.skill +
        availability * ASSIGNMENT_WEIGHTS.availability +
        inverseWorkload * ASSIGNMENT_WEIGHTS.workload) *
        10,
    ) / 10;
  return { technician: t, score, skillMatch, availability, inverseWorkload, eligible, reasons };
}

export function scoreContractor(c: ContractorCandidate, categoryKey: string): ScoredContractor {
  const reasons: string[] = [];
  const categoryMatch = c.categoryKey === categoryKey ? 1 : 0;
  const ratingScore = Math.max(0, Math.min(1, c.rating / 5));
  const responseScore = c.avgResponseMinutes > 0 ? 1 - Math.min(c.avgResponseMinutes / 240, 1) : 0.5;
  if (!c.isActive) reasons.push("Inactive");
  reasons.push(categoryMatch ? `${categoryKey} contractor` : "Different specialty");
  reasons.push(`Rating ${c.rating.toFixed(1)}`);
  const score = Math.round((categoryMatch * 50 + ratingScore * 30 + responseScore * 20) * 10) / 10;
  return { contractor: c, score, eligible: c.isActive && categoryMatch === 1, reasons };
}

export type AssignmentStrategy = "TECHNICIAN" | "CONTRACTOR" | "NONE";

export interface AssignmentRecommendation {
  strategy: AssignmentStrategy;
  technician: ScoredTechnician | null;
  contractor: ScoredContractor | null;
  rankedTechnicians: ScoredTechnician[];
  rankedContractors: ScoredContractor[];
  reason: string;
}

export function recommendAssignment(args: {
  categoryKey: string;
  requiredSkill: string;
  technicians: TechnicianCandidate[];
  contractors: ContractorCandidate[];
}): AssignmentRecommendation {
  const rankedTechnicians = args.technicians
    .map((t) => scoreTechnician(t, args.requiredSkill))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  const rankedContractors = args.contractors
    .map((c) => scoreContractor(c, args.categoryKey))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);

  const specialist = rankedTechnicians.find((s) => s.eligible && s.skillMatch === 1) ?? null;
  const contractor = rankedContractors.find((c) => c.eligible) ?? null;
  const generalist = rankedTechnicians.find((s) => s.eligible) ?? null;

  if (specialist) {
    return {
      strategy: "TECHNICIAN",
      technician: specialist,
      contractor,
      rankedTechnicians,
      rankedContractors,
      reason: `Best-scoring ${args.requiredSkill} technician: ${specialist.technician.name} (score ${specialist.score})`,
    };
  }
  if (contractor) {
    return {
      strategy: "CONTRACTOR",
      technician: null,
      contractor,
      rankedTechnicians,
      rankedContractors,
      reason: `No internal ${args.requiredSkill} technician available — recommend contractor ${contractor.contractor.name} (needs manager confirmation)`,
    };
  }
  if (generalist) {
    return {
      strategy: "TECHNICIAN",
      technician: generalist,
      contractor: null,
      rankedTechnicians,
      rankedContractors,
      reason: `No specialist or contractor available — assigned general technician ${generalist.technician.name}`,
    };
  }
  return {
    strategy: "NONE",
    technician: null,
    contractor: null,
    rankedTechnicians,
    rankedContractors,
    reason: "No eligible technician or contractor — manual assignment required",
  };
}

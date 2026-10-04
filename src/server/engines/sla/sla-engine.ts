import type { Priority } from "@/server/domain/constants";

export interface SlaPolicyConfig {
  responseMinutes: number;
  resolutionMinutes: number;
}

/**
 * Default SLA policy. "Response" = time to acknowledge/dispatch (the headline SLA
 * shown to residents, e.g. Emergency = 30 min). "Resolution" = time to complete.
 * Stored in the `SLA` table and editable; these are only the defaults.
 */
export const DEFAULT_SLA_POLICIES: Record<Priority, SlaPolicyConfig> = {
  EMERGENCY: { responseMinutes: 30, resolutionMinutes: 4 * 60 },
  CRITICAL: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
  HIGH: { responseMinutes: 2 * 60, resolutionMinutes: 24 * 60 },
  MEDIUM: { responseMinutes: 8 * 60, resolutionMinutes: 48 * 60 },
  LOW: { responseMinutes: 48 * 60, resolutionMinutes: 120 * 60 },
};

export interface SlaDeadlines {
  responseDueAt: Date;
  resolutionDueAt: Date;
  responseMinutes: number;
  resolutionMinutes: number;
}

const MIN = 60_000;

/**
 * Computes SLA deadlines when a ticket is created (or re-prioritised).
 * The resolution target is the STRICTER of the priority policy and the category default.
 */
export function computeSlaDeadlines(args: {
  priority: Priority;
  createdAt: Date;
  policies?: Partial<Record<Priority, SlaPolicyConfig>>;
  categoryResolutionMinutes?: number | null;
}): SlaDeadlines {
  const policy = args.policies?.[args.priority] ?? DEFAULT_SLA_POLICIES[args.priority];
  const responseMinutes = policy.responseMinutes;
  let resolutionMinutes = policy.resolutionMinutes;
  if (args.categoryResolutionMinutes && args.categoryResolutionMinutes > 0) {
    resolutionMinutes = Math.min(resolutionMinutes, args.categoryResolutionMinutes);
  }
  resolutionMinutes = Math.max(resolutionMinutes, responseMinutes);
  const t = args.createdAt.getTime();
  return {
    responseMinutes,
    resolutionMinutes,
    responseDueAt: new Date(t + responseMinutes * MIN),
    resolutionDueAt: new Date(t + resolutionMinutes * MIN),
  };
}

export type SlaState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "MET_LATE" | "NONE";

export interface SlaClock {
  state: SlaState;
  dueAt: Date | null;
  /** ms until due (negative when overdue); null when finished */
  remainingMs: number | null;
  /** ms from creation until the milestone (or now) */
  elapsedMs: number;
  /** 0..1+ fraction of the SLA window consumed */
  consumed: number;
  metAt: Date | null;
}

export interface SlaStatus {
  response: SlaClock;
  resolution: SlaClock;
  overall: SlaState;
  breached: boolean;
}

const SEVERITY: Record<SlaState, number> = { BREACHED: 5, MET_LATE: 4, AT_RISK: 3, ON_TRACK: 2, MET: 1, NONE: 0 };

/** Fraction of the window after which a running clock is flagged AT_RISK */
export const AT_RISK_THRESHOLD = 0.75;

function clock(createdAt: Date, dueAt: Date | null, metAt: Date | null, now: Date): SlaClock {
  const start = createdAt.getTime();
  const end = (metAt ?? now).getTime();
  const elapsedMs = Math.max(0, end - start);
  if (!dueAt) return { state: "NONE", dueAt: null, remainingMs: null, elapsedMs, consumed: 0, metAt };
  const window = Math.max(1, dueAt.getTime() - start);
  const consumed = elapsedMs / window;
  if (metAt) {
    return {
      state: metAt.getTime() <= dueAt.getTime() ? "MET" : "MET_LATE",
      dueAt,
      remainingMs: null,
      elapsedMs,
      consumed,
      metAt,
    };
  }
  const remainingMs = dueAt.getTime() - now.getTime();
  const state: SlaState = remainingMs < 0 ? "BREACHED" : consumed >= AT_RISK_THRESHOLD ? "AT_RISK" : "ON_TRACK";
  return { state, dueAt, remainingMs, elapsedMs, consumed, metAt: null };
}

/** Live SLA status for a ticket. Pure: pass `now` for determinism. */
export function getSlaStatus(t: {
  createdAt: Date;
  slaResponseDueAt: Date | null;
  slaResolutionDueAt: Date | null;
  acknowledgedAt: Date | null;
  completedAt: Date | null;
  cancelledAt?: Date | null;
  now?: Date;
}): SlaStatus {
  const now = t.now ?? new Date();
  const response = clock(t.createdAt, t.slaResponseDueAt, t.acknowledgedAt, now);
  const resolution = clock(t.createdAt, t.slaResolutionDueAt, t.completedAt ?? t.cancelledAt ?? null, now);
  const breached =
    response.state === "BREACHED" ||
    response.state === "MET_LATE" ||
    resolution.state === "BREACHED" ||
    resolution.state === "MET_LATE";
  // Overall = the "worst" of the two clocks.
  const overall = SEVERITY[response.state] > SEVERITY[resolution.state] ? response.state : resolution.state;
  return { response, resolution, overall, breached };
}

/** "2h 05m", "3d 4h", "45m" */
export function formatDuration(ms: number): string {
  const neg = ms < 0;
  let m = Math.floor(Math.abs(ms) / MIN);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  const s = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return neg ? `-${s}` : s;
}

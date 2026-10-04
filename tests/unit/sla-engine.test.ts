import { describe, expect, it } from "vitest";
import { computeSlaDeadlines, formatDuration, getSlaStatus, DEFAULT_SLA_POLICIES } from "@/server/engines/sla/sla-engine";

const t0 = new Date("2026-10-04T10:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

describe("SLA engine", () => {
  it.each([
    ["EMERGENCY", 30],
    ["CRITICAL", 60],
    ["HIGH", 120],
    ["MEDIUM", 480],
    ["LOW", 2880],
  ] as const)("%s response SLA = %i minutes", (priority, minutes) => {
    const d = computeSlaDeadlines({ priority, createdAt: t0 });
    expect(d.responseMinutes).toBe(minutes);
    expect(d.responseDueAt.toISOString()).toBe(min(minutes).toISOString());
  });

  it("uses the stricter of priority and category resolution targets", () => {
    const d = computeSlaDeadlines({ priority: "MEDIUM", createdAt: t0, categoryResolutionMinutes: 24 * 60 });
    expect(d.resolutionMinutes).toBe(24 * 60);
    // resolution can never be shorter than the response window
    const low = computeSlaDeadlines({ priority: "LOW", createdAt: t0, categoryResolutionMinutes: 60 });
    expect(low.resolutionMinutes).toBe(low.responseMinutes);
    const e = computeSlaDeadlines({ priority: "EMERGENCY", createdAt: t0, categoryResolutionMinutes: 24 * 60 });
    expect(e.resolutionMinutes).toBe(DEFAULT_SLA_POLICIES.EMERGENCY.resolutionMinutes);
  });

  it("honours custom policies", () => {
    const d = computeSlaDeadlines({ priority: "HIGH", createdAt: t0, policies: { HIGH: { responseMinutes: 15, resolutionMinutes: 60 } } });
    expect(d.responseMinutes).toBe(15);
    expect(d.resolutionMinutes).toBe(60);
  });

  const base = { createdAt: t0, slaResponseDueAt: min(30), slaResolutionDueAt: min(240), acknowledgedAt: null, completedAt: null };

  it("is ON_TRACK early, AT_RISK after 75% and BREACHED after due", () => {
    expect(getSlaStatus({ ...base, now: min(5) }).response.state).toBe("ON_TRACK");
    expect(getSlaStatus({ ...base, now: min(25) }).response.state).toBe("AT_RISK");
    const s = getSlaStatus({ ...base, now: min(31) });
    expect(s.response.state).toBe("BREACHED");
    expect(s.breached).toBe(true);
    expect(s.overall).toBe("BREACHED");
    expect(s.response.remainingMs).toBeLessThan(0);
  });

  it("marks MET when acknowledged in time and tracks time-to-acknowledge", () => {
    const s = getSlaStatus({ ...base, acknowledgedAt: min(12), now: min(60) });
    expect(s.response.state).toBe("MET");
    expect(s.response.elapsedMs).toBe(12 * 60_000);
    expect(s.overall).toBe("ON_TRACK");
  });

  it("marks MET_LATE when resolved after the deadline", () => {
    const s = getSlaStatus({ ...base, acknowledgedAt: min(10), completedAt: min(300), now: min(400) });
    expect(s.resolution.state).toBe("MET_LATE");
    expect(s.breached).toBe(true);
  });

  it("formats durations", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
    expect(formatDuration(-(26 * 60) * 60_000)).toBe("-1d 2h");
  });
});

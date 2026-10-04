import { describe, expect, it } from "vitest";
import { canApproveAmount, computeQuotationTotals, requiresQuotation } from "@/server/engines/quotation/quotation-engine";

describe("quotation engine", () => {
  it("computes labor, materials, 14% VAT and total", () => {
    const q = computeQuotationTotals([
      { type: "LABOR", description: "Compressor replacement labor", quantity: 3, unitPrice: 250 },
      { type: "MATERIAL", description: "Compressor 1.5HP", quantity: 1, unitPrice: 4200 },
      { type: "MATERIAL", description: "R410 gas", quantity: 2, unitPrice: 350.5 },
    ]);
    expect(q.laborCost).toBe(750);
    expect(q.materialsCost).toBe(4901);
    expect(q.subtotal).toBe(5651);
    expect(q.vatAmount).toBe(791.14);
    expect(q.total).toBe(6442.14);
  });

  it("validates inputs", () => {
    expect(() => computeQuotationTotals([])).toThrow();
    expect(() => computeQuotationTotals([{ type: "LABOR", description: "x", quantity: 0, unitPrice: 1 }])).toThrow();
    expect(() => computeQuotationTotals([{ type: "LABOR", description: "x", quantity: 1, unitPrice: -5 }])).toThrow();
  });

  it("enforces approval limits by role", () => {
    expect(canApproveAmount("MAINTENANCE_MANAGER", 9_999)).toBe(true);
    expect(canApproveAmount("MAINTENANCE_MANAGER", 15_000)).toBe(false);
    expect(canApproveAmount("COMPOUND_MANAGER", 15_000)).toBe(true);
    expect(canApproveAmount("TECHNICIAN", 10)).toBe(false);
    expect(canApproveAmount("ADMIN", 10_000_000)).toBe(true);
  });

  it("requires a quotation above the category threshold", () => {
    expect(requiresQuotation(2000, 1500)).toBe(true);
    expect(requiresQuotation(1000, 1500)).toBe(false);
    expect(requiresQuotation(null, 1500)).toBe(false);
  });
});

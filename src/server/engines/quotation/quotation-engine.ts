import { DEFAULT_VAT_RATE, type Role } from "@/server/domain/constants";

export interface QuotationItemInput {
  type: "LABOR" | "MATERIAL";
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuotationTotals {
  items: (QuotationItemInput & { total: number })[];
  laborCost: number;
  materialsCost: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export class QuotationValidationError extends Error {
  readonly code = "INVALID_QUOTATION";
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeQuotationTotals(items: QuotationItemInput[], vatRate = DEFAULT_VAT_RATE): QuotationTotals {
  if (!items.length) throw new QuotationValidationError("A quotation needs at least one line item");
  if (vatRate < 0 || vatRate > 1) throw new QuotationValidationError("VAT rate must be between 0 and 1");
  const lines = items.map((i) => {
    if (i.quantity <= 0) throw new QuotationValidationError(`Invalid quantity for "${i.description}"`);
    if (i.unitPrice < 0) throw new QuotationValidationError(`Invalid unit price for "${i.description}"`);
    return { ...i, total: round2(i.quantity * i.unitPrice) };
  });
  const laborCost = round2(lines.filter((l) => l.type === "LABOR").reduce((s, l) => s + l.total, 0));
  const materialsCost = round2(lines.filter((l) => l.type === "MATERIAL").reduce((s, l) => s + l.total, 0));
  const subtotal = round2(laborCost + materialsCost);
  const vatAmount = round2(subtotal * vatRate);
  return { items: lines, laborCost, materialsCost, subtotal, vatRate, vatAmount, total: round2(subtotal + vatAmount) };
}

/**
 * Approval authority matrix (EGP, VAT inclusive).
 * Maintenance managers approve routine spend; larger amounts need the compound manager.
 */
export const APPROVAL_LIMITS: Partial<Record<Role, number>> = {
  MAINTENANCE_MANAGER: 10_000,
  COMPOUND_MANAGER: 100_000,
  ADMIN: Number.POSITIVE_INFINITY,
};

export function canApproveAmount(role: Role, total: number): boolean {
  const limit = APPROVAL_LIMITS[role];
  return typeof limit === "number" && total <= limit;
}

/** Whether the ticket should go through the quotation flow given an estimate. */
export function requiresQuotation(estimatedCost: number | null | undefined, threshold: number): boolean {
  return typeof estimatedCost === "number" && estimatedCost > threshold;
}

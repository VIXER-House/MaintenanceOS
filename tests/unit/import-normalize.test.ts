import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "@/lib/import/core";
import { findUnitInText, normalizeUnitCode } from "@/server/domain/unit-codes";

describe("phone normalisation", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["010 1234 5678", "+201012345678"],
    ["1012345678", "+201012345678"], // Excel dropped the leading 0
    ["+20 101 234 5678", "+201012345678"],
    ["00201012345678", "+201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["+966 50 123 4567", "+966501234567"],
  ])("%s → %s", (input, out) => expect(normalizePhoneNumber(input)).toBe(out));
  it.each(["12345", "0101234567", "02 2345 6789", "abc", ""])("rejects %s", (input) => expect(normalizePhoneNumber(input)).toBeNull());
});

describe("unit codes", () => {
  const units = [{ code: "A01-101" }, { code: "VILLA 12" }, { code: "B3/105" }];
  it("normalises separators, case and Arabic digits", () => {
    expect(normalizeUnitCode("a01 - 101")).toBe("A-01-101");
    expect(normalizeUnitCode("A01-101")).toBe(normalizeUnitCode("a01 101"));
    expect(normalizeUnitCode("فيلا ١٢")).toBe("VILLA-12");
  });
  it("keeps different codes apart (Q1-110 vs Q11-10)", () => {
    expect(normalizeUnitCode("Q1-110")).not.toBe(normalizeUnitCode("Q11-10"));
    const both = [{ code: "Q1-110" }, { code: "Q11-10" }];
    expect(findUnitInText("q11 10", both)?.unit.code).toBe("Q11-10");
    expect(findUnitInText("Q110", both)).toBeNull(); // ambiguous without separators
    expect(findUnitInText("a01101", [{ code: "A01-101" }])?.unit.code).toBe("A01-101"); // unambiguous → ok
  });
  it.each([
    ["A01-101 الحنفية بتسرب", "A01-101"],
    ["انا ساكن في a01 101", "A01-101"],
    ["فيلا ١٢ التكييف بايظ", "VILLA 12"],
    ["b3-105", "B3/105"],
  ])("finds the unit in “%s”", (text, code) => expect(findUnitInText(text, units)?.unit.code).toBe(code));
  it("returns null when no unit is mentioned", () => expect(findUnitInText("الحنفية بتسرب", units)).toBeNull());
});

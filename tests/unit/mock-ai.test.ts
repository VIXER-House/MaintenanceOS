import { describe, expect, it } from "vitest";
import { MockAIProvider } from "@/server/providers/ai/mock-ai.provider";

const ai = new MockAIProvider();

describe("MockAIProvider (deterministic Egyptian-Arabic NLU)", () => {
  it.each([
    ["التكييف مش شغال", "HVAC"],
    ["التكييف بينقط ميه", "HVAC"],
    ["الحنفية بتسرب", "PLUMBING"],
    ["فيه ماسورة انفجرت", "PLUMBING"],
    ["الكهربا قاطعة في الشقة", "ELECTRICAL"],
    ["الأسانسير واقف", "ELEVATOR"],
    ["اللمبة في المدخل اتحرقت", "ELECTRICAL"],
    ["الباب مش بيقفل", "CARPENTRY"],
    ["المياه ضعيفة", "PLUMBING"],
    ["السخان مش شغال", "APPLIANCES"],
    ["The AC in the bedroom is not cooling", "HVAC"],
  ])("%s → %s", async (text, category) => {
    const c = await ai.classifyMaintenanceRequest({ text });
    expect(c.category).toBe(category);
    expect(c.isMaintenanceRequest).toBe(true);
  });

  it("extracts issue, location and asset from 'التكييف في أوضة النوم مش بيبرد'", async () => {
    const c = await ai.classifyMaintenanceRequest({
      text: "التكييف في أوضة النوم مش بيبرد",
      knownAssets: [
        { assetCode: "AC-101-LR", name: "Split AC", type: "AC", location: "Living room" },
        { assetCode: "AC-101-BR", name: "Split AC", type: "AC", location: "Bedroom" },
      ],
    });
    expect(c.issue).toBe("Cooling failure");
    expect(c.location).toBe("Bedroom");
    expect(c.assetCode).toBe("AC-101-BR");
    expect(c.priority).toBe("MEDIUM");
    expect(c.confidence).toBeGreaterThan(0.7);
  });

  it("asks about leak severity, then escalates on the answer", async () => {
    const first = await ai.classifyMaintenanceRequest({ text: "فيه تسريب مياه في المطبخ" });
    expect(first.needsMoreInfo).toBe(true);
    expect(first.followUpQuestion).toContain("التسريب");
    const second = await ai.classifyMaintenanceRequest({
      text: "المياه كتير",
      history: [{ role: "resident", text: "فيه تسريب مياه في المطبخ" }],
      disallowFollowUp: true,
    });
    expect(second.needsMoreInfo).toBe(false);
    expect(second.severity).toBe("severe");
    expect(second.priority).toBe("EMERGENCY");
    expect(second.location).toBe("Kitchen");
  });

  it("treats greetings as non-maintenance", async () => {
    const c = await ai.classifyMaintenanceRequest({ text: "السلام عليكم" });
    expect(c.isMaintenanceRequest).toBe(false);
  });

  it("asks for details when it cannot classify", async () => {
    const c = await ai.classifyMaintenanceRequest({ text: "فيه مشكلة عندي" });
    expect(c.category).toBe("OTHER");
    expect(c.needsMoreInfo).toBe(true);
  });
});

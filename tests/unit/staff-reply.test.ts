import { describe, expect, it } from "vitest";
import { parseStaffReply } from "@/server/services/staff-whatsapp.service";
import { parseUnitAlertAnswer } from "@/server/services/fake-report.service";

describe("technician WhatsApp replies", () => {
  it.each(["1", "١", "تمام", "موافق", "ok", "1 MAINT-000123", "حاضر جاي"])("“%s” = accept", (t) => expect(parseStaffReply(t).kind).toBe("accept"));
  it("reads the ticket number", () => expect(parseStaffReply("1 maint-000123")).toMatchObject({ kind: "accept", ticketNumber: 123 }));
  it.each([
    ["2 عندي ظرف عائلي", "عندي ظرف عائلي"],
    ["٢ - تعبان النهارده", "تعبان النهارده"],
    ["مش هقدر النهارده عشان العربية عطلانة", "مش هقدر النهارده عشان العربية عطلانة"],
  ])("“%s” = decline with reason", (t, reason) => expect(parseStaffReply(t)).toMatchObject({ kind: "decline", reason }));
  it("“2” alone = decline without reason", () => expect(parseStaffReply("2")).toMatchObject({ kind: "decline", reason: "" }));
  it.each(["مهامي", "jobs"])("“%s” = list", (t) => expect(parseStaffReply(t).kind).toBe("list"));
  it.each(["السلام عليكم", "الصورة اهي"])("“%s” = unknown", (t) => expect(parseStaffReply(t).kind).toBe("unknown"));
});

describe("fake-report replies", () => {
  it.each(["3", "٣ الساكن قال محدش طلب", "بلاغ وهمي", "fake"])("“%s” = fake", (t) => expect(parseStaffReply(t).kind).toBe("fake"));
  it("keeps the reason", () => expect(parseStaffReply("3 الساكن قال محدش طلب")).toMatchObject({ kind: "fake", reason: "الساكن قال محدش طلب" }));
  it("bare 3 has no reason", () => expect(parseStaffReply("3")).toMatchObject({ kind: "fake", reason: "" }));
  it("0 lists jobs", () => expect(parseStaffReply("0").kind).toBe("list"));
});

describe("unit alert answers", () => {
  it.each(["1", "ايوه", "اه ده ابني", "yes"])("“%s” = confirm", (t) => expect(parseUnitAlertAnswer(t)).toBe("confirm"));
  it.each(["2", "لا", "مش انا", "محدش طلب", "معرفوش", "not me"])("“%s” = deny", (t) => expect(parseUnitAlertAnswer(t)).toBe("deny"));
  it.each(["الحنفية بتنقط في المطبخ", "عايز اعرف حالة الطلب"])("“%s” = not an answer", (t) => expect(parseUnitAlertAnswer(t)).toBeNull());
});

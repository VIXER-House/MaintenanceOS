import { describe, expect, it } from "vitest";
import { parseStaffReply } from "@/server/services/staff-whatsapp.service";

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

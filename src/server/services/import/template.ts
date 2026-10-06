import ExcelJS from "exceljs";
import type { ImportType } from "@/lib/import/core";
import { IMPORT_DEFINITIONS } from "@/lib/import/definitions";

const GENERAL_NOTES = [
  "• Delete the grey example rows, then add your data (one row per record).",
  "  امسح الصفوف الرمادي (أمثلة) وبعدين اكتب بياناتك (صف لكل سجل).",
  "• Columns marked * are required.  الأعمدة اللي عليها * مطلوبة.",
  "• Column titles can be in English or Arabic, in any order. Extra columns are ignored.",
  "  أسماء الأعمدة ممكن تكون عربي أو إنجليزي وبأي ترتيب، والأعمدة الزيادة بيتم تجاهلها.",
  "• Mobile: 01XXXXXXXXX or +20… — other countries with + and the country code.",
  "• Dates: 2024-03-15 or 15/03/2024.  التواريخ: 2024-03-15 أو 15/03/2024.",
  "• Re-uploading an updated file updates existing records — nothing is duplicated.",
  "  رفع الملف تاني بعد التعديل بيحدّث البيانات الموجودة من غير تكرار.",
  "• The system checks everything first and shows each problem with its row number — nothing is saved until you confirm.",
  "  النظام بيراجع كل حاجة الأول ويوضح أي مشكلة برقم الصف — ومفيش حاجة بتتحفظ غير بعد تأكيدك.",
];

export async function buildImportTemplate(type: ImportType): Promise<Buffer> {
  const def = IMPORT_DEFINITIONS[type];
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintenanceOS";
  const ws = wb.addWorksheet(def.title.en.replace(/[^\w ]/g, "").slice(0, 28) || "Data", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = def.columns.map((c) => ({ header: `${c.header}${c.required ? " *" : ""}`, key: c.field, width: c.width ?? 18, style: c.text ? { numFmt: "@" } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  head.height = 22;
  const n = Math.max(...def.columns.map((c) => c.examples.length));
  for (let i = 0; i < n; i++) {
    const r = ws.addRow(Object.fromEntries(def.columns.map((c) => [c.field, c.examples[i] ?? ""])));
    r.font = { color: { argb: "FF64748B" }, italic: true };
  }
  def.columns.forEach((c, idx) => {
    if (!c.list) return;
    for (let r = 2; r <= 1001; r++) ws.getCell(r, idx + 1).dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`] };
  });

  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 120;
  const lines = [
    `${def.title.en} / ${def.title.ar}`,
    def.description.en,
    def.description.ar,
    `Re-importing updates records with the same ${def.matchBy.en}.  إعادة الرفع بتحدّث السجلات بنفس ${def.matchBy.ar}.`,
    "",
    ...GENERAL_NOTES,
    "",
    "Columns / الأعمدة:",
    ...def.columns.map((c) => `  ${c.header}${c.required ? "  (required / مطلوب)" : ""}${c.list ? `  — ${c.list.join(" / ")}` : ""}`),
  ];
  lines.forEach((l, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = l;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

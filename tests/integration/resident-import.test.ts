/**
 * Data import (all types) against a real database. Mirrors what the browser does:
 * read table → map headers → check rows → send chunks to preview / commit.
 */
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CHUNK_SIZE, cellText, mapTable, parseCsv, type ImportType } from "@/lib/import/core";
import { IMPORT_DEFINITIONS, checkRows } from "@/lib/import/definitions";
import { commitChunk, previewChunk } from "@/server/services/import";
import { buildImportTemplate } from "@/server/services/import/template";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";

let dbUp = false;
const TAG = `T${Date.now().toString().slice(-6)}`;
const stamp = Date.now().toString().slice(-3);
const mob = (n: number) => `0101${stamp}${String(n).padStart(4, "0")}`;

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = (await db.compound.count()) > 0;
  } catch {
    dbUp = false;
  }
});
afterAll(async () => {
  if (dbUp) {
    await db.assetMaintenance.deleteMany({ where: { asset: { assetCode: { startsWith: TAG } } } });
    await db.asset.deleteMany({ where: { assetCode: { startsWith: TAG } } });
    await db.resident.deleteMany({ where: { unit: { code: { startsWith: TAG } } } });
    await db.unit.deleteMany({ where: { code: { startsWith: TAG } } });
    await db.building.deleteMany({ where: { code: { startsWith: TAG } } });
    const techs = await db.technician.findMany({ where: { phone: { startsWith: `+20101${stamp}` } }, select: { id: true, userId: true } });
    await db.technician.deleteMany({ where: { id: { in: techs.map((t) => t.id) } } });
    await db.user.deleteMany({ where: { id: { in: techs.map((t) => t.userId) } } });
    await db.team.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.contractor.deleteMany({ where: { name: { startsWith: TAG } } });
  }
  await db.$disconnect();
});

async function xlsxTable(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1").addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const out: string[][] = [];
  wb2.worksheets[0].eachRow({ includeEmpty: true }, (r, n) => {
    out[n - 1] = Array.from({ length: r.cellCount }, (_, i) => cellText(r.getCell(i + 1).value).trim());
  });
  return Array.from(out, (r) => r ?? []);
}

/** What the browser does, end to end. */
async function run(type: ImportType, table: string[][], mode: "preview" | "commit", skipInvalid = false) {
  const def = IMPORT_DEFINITIONS[type];
  const mapped = mapTable(table, def.columns);
  if (!mapped) throw new Error("no header");
  const { issues } = checkRows(def, mapped.rows);
  const errorRows = new Set(issues.filter((i) => i.level === "error").map((i) => i.row));
  const ok = mapped.rows.filter((r) => !errorRows.has(r.row));
  const preview = { issues: [...issues], actions: [] as { row: number; action: string }[], newUnits: new Set<string>(), newBuildings: new Set<string>(), newTeams: new Set<string>() };
  for (let i = 0; i < ok.length; i += CHUNK_SIZE) {
    const r = await previewChunk(type, null, ok.slice(i, i + CHUNK_SIZE));
    preview.issues.push(...r.issues.filter((x) => !issues.some((y) => y.row === x.row && y.message === x.message)));
    preview.actions.push(...r.actions);
    r.newUnits.forEach((u) => preview.newUnits.add(u));
    r.newBuildings.forEach((b) => preview.newBuildings.add(b));
    r.newTeams.forEach((x) => preview.newTeams.add(x));
  }
  const errRows = new Set(preview.issues.filter((i) => i.level === "error").map((i) => i.row));
  if (mode === "preview") return { preview, errRows, result: null };
  if (errRows.size && !skipInvalid) throw new Error("has errors");
  const toSend = mapped.rows.filter((r) => !errRows.has(r.row) && preview.actions.find((a) => a.row === r.row)?.action !== "unchanged");
  const result = { created: 0, updated: 0, unchanged: 0, credentials: [] as { email: string; password: string }[] };
  for (let i = 0; i < toSend.length; i += CHUNK_SIZE) {
    const r = await commitChunk(type, null, toSend.slice(i, i + CHUNK_SIZE));
    result.created += r.created;
    result.updated += r.updated;
    result.credentials.push(...(r.credentials ?? []));
  }
  return { preview, errRows, result };
}

const count = (p: { actions: { action: string }[] }, a: string) => p.actions.filter((x) => x.action === a).length;

describe.runIf(process.env.DATABASE_URL)("data import (integration)", () => {
  it("every template is accepted by its own importer", async () => {
    if (!dbUp) return;
    for (const type of Object.keys(IMPORT_DEFINITIONS) as ImportType[]) {
      const table = await xlsxTable([]); // placeholder to keep the helper warm
      expect(table).toBeTruthy();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await buildImportTemplate(type)) as unknown as ArrayBuffer);
      const rows: string[][] = [];
      wb.worksheets[0].eachRow((r) => rows.push(Array.from({ length: r.cellCount }, (_, i) => cellText(r.getCell(i + 1).value))));
      const mapped = mapTable(rows, IMPORT_DEFINITIONS[type].columns);
      expect(mapped?.missing, type).toEqual([]);
      expect(mapped?.columns.every((c) => c.field), type).toBe(true);
    }
  });

  it("units: creates units + buildings, re-import updates", async () => {
    if (!dbUp) return;
    const table = await xlsxTable([
      ["Building", "Unit code", "Floor", "Unit type", "Area m²"],
      [`${TAG}A`, `${TAG}A-101`, 1, "Apartment", 150],
      ["", `${TAG}A-102`, 1, "Apartment", "180"],
      ["", `${TAG}V 12`, "", "Villa", "320"],
      ["", `${TAG}A-101`, 2, "", ""], // duplicate unit
    ]);
    const p = await run("units", table, "preview");
    expect(count(p.preview, "new")).toBe(3);
    expect(p.preview.newBuildings.size).toBe(2);
    expect(p.errRows.has(5)).toBe(true);
    const c = await run("units", table, "commit", true);
    expect(c.result!.created).toBe(3);
    table[2][2] = "3";
    const again = await run("units", table.slice(0, 4), "commit");
    expect(again.result!.updated).toBe(1);
    expect((await db.unit.findUniqueOrThrow({ where: { code: `${TAG}A-102` } })).floor).toBe(3);
  });

  it("residents: messy Arabic sheet, dry run saves nothing, import + re-import without duplicates", async () => {
    if (!dbUp) return;
    const rows: (string | number)[][] = [
      ["العمارة", "رقم الوحدة", "الدور", "الاسم", "الموبايل", "الصفة", "ملاحظات"],
      [`${TAG}A`, `${TAG}A-101`, 1, "أحمد حسن", mob(1), "مالك", "x"],
      ["", `${TAG}A-101`, 1, "Mona Ali", Number(mob(2).slice(1)), "مستأجر", ""],
      [`${TAG}B`, `${TAG}B-201`, "ارضي", "كريم", "+20 " + mob(3).slice(1), "", ""],
      [`${TAG}A`, `${TAG}A-103`, 1, "سارة", mob(1), "", ""], // duplicate phone
      [`${TAG}A`, "", 1, "بدون وحدة", "01099999999", "", ""],
      [`${TAG}A`, `${TAG}A-104`, 1, "رقم غلط", "12345", "", ""],
    ];
    const table = await xlsxTable(rows);
    const before = await db.resident.count();
    const p = await run("residents", table, "preview");
    expect(count(p.preview, "new")).toBe(3);
    expect([...p.errRows].sort()).toEqual([5, 6, 7]);
    expect(p.preview.newUnits.size).toBe(1); // B-201 (A-101 exists from the units test)
    expect(await db.resident.count()).toBe(before);
    await expect(run("residents", table, "commit")).rejects.toThrow(/errors/);
    const c = await run("residents", table, "commit", true);
    expect(c.result!.created).toBe(3);
    const mona = await db.resident.findUniqueOrThrow({ where: { phone: `+2${mob(2)}` }, include: { unit: true } });
    expect(mona.unit?.code).toBe(`${TAG}A-101`);
    expect(mona.isOwner).toBe(false);
    expect(mona.verified).toBe(true);
    rows[2][3] = "Mona Ali Hassan";
    const again = await run("residents", await xlsxTable(rows.slice(0, 4)), "commit");
    expect(again.result!.created).toBe(0);
    expect(again.result!.updated).toBe(1);
  });

  it("technicians: maps Arabic/English skills, creates teams and one-time logins", async () => {
    if (!dbUp) return;
    const table = parseCsv(
      [
        "Name,Mobile,Skills,Team,Max open jobs,Status",
        `${TAG} Hany,${mob(11)},"سباكة, Painting",${TAG} Civil,6,available`,
        `${TAG} Fady,${mob(12)},تكييف,,5,off`,
        `${TAG} Bad,${mob(13)},Astronaut,,5,`,
      ].join("\n"),
    );
    const p = await run("technicians", table, "preview");
    expect(count(p.preview, "new")).toBe(2);
    expect(p.preview.newTeams.has(`${TAG} Civil`)).toBe(true);
    expect(p.preview.issues.some((i) => i.row === 4 && /Unknown skill/.test(i.message))).toBe(true);
    const c = await run("technicians", table, "commit", true);
    expect(c.result!.created).toBe(2);
    expect(c.result!.credentials).toHaveLength(2);
    const hany = await db.technician.findFirstOrThrow({ where: { phone: `+2${mob(11)}` }, include: { team: true, user: true } });
    expect(hany.skills.sort()).toEqual(["PAINTING", "PLUMBING"]);
    expect(hany.team?.name).toBe(`${TAG} Civil`);
    expect(hany.maxConcurrent).toBe(6);
    expect(hany.user.role).toBe("TECHNICIAN");
    const again = await run("technicians", table.slice(0, 3), "preview");
    expect(count(again.preview, "unchanged")).toBe(2);
  });

  it("contractors: category by Arabic/English name, landline phones", async () => {
    if (!dbUp) return;
    const table = await xlsxTable([
      ["الشركة", "التصنيف", "التليفون", "فعال"],
      [`${TAG} Lift Co`, "مصاعد", "0223456789", "نعم"],
      [`${TAG} Cool`, "HVAC", mob(21), "no"],
      [`${TAG} ???`, "Rocket science", mob(22), ""],
    ]);
    const c = await run("contractors", table, "commit", true);
    expect(c.result!.created).toBe(2);
    const lift = await db.contractor.findFirstOrThrow({ where: { name: `${TAG} Lift Co` }, include: { category: true } });
    expect(lift.category?.key).toBe("ELEVATOR");
    expect(lift.phone).toBe("+20223456789");
    expect((await db.contractor.findFirstOrThrow({ where: { name: `${TAG} Cool` } })).isActive).toBe(false);
  });

  it("assets then maintenance history (no double entries)", async () => {
    if (!dbUp) return;
    const assets = await xlsxTable([
      ["Asset code", "Name", "Type", "Category", "Building", "Unit code", "Installed on", "Warranty until", "Status"],
      [`${TAG}-ELV-1`, "Elevator 1", "Elevator", "Elevator", `${TAG}A`, "", "15/03/2020", "2027-03-15", "operational"],
      [`${TAG}-AC-1`, "Living room AC", "Split AC", "تكييف", "", `${TAG}A-101`, "2022-07-10", "", "needs attention"],
      [`${TAG}-X`, "Ghost", "Pump", "", "", "NOPE-999", "", "", ""],
    ]);
    const a = await run("assets", assets, "commit", true);
    expect(a.result!.created).toBe(2);
    const ac = await db.asset.findUniqueOrThrow({ where: { assetCode: `${TAG}-AC-1` }, include: { unit: true, category: true } });
    expect(ac.unit?.code).toBe(`${TAG}A-101`);
    expect(ac.category?.key).toBe("HVAC");
    expect(ac.status).toBe("NEEDS_ATTENTION");
    expect((await db.asset.findUniqueOrThrow({ where: { assetCode: `${TAG}-ELV-1` } })).installationDate?.toISOString().slice(0, 10)).toBe("2020-03-15");

    const hist = await xlsxTable([
      ["كود الأصل", "التاريخ", "النوع", "الأعمال", "التكلفة"],
      [`${TAG}-ELV-1`, "2025-01-10", "وقائي", "Monthly service", "1,500"],
      [`${TAG}-ELV-1`, "2025-01-10", "وقائي", "Monthly service", "1500"], // same visit twice in the file
      [`${TAG}-ELV-1`, "12/04/2025", "إصلاح", "Replaced door sensor", "3200 EGP"],
      [`${TAG}-NOPE`, "2025-01-10", "", "x", ""],
    ]);
    const h = await run("history", hist, "commit", true);
    expect(h.result!.created).toBe(2);
    const again = await run("history", hist.slice(0, 2), "preview");
    expect(count(again.preview, "unchanged")).toBe(1);
    const rows = await db.assetMaintenance.findMany({ where: { asset: { assetCode: `${TAG}-ELV-1` } }, orderBy: { date: "asc" } });
    expect(rows.map((r) => [r.type, Number(r.cost)])).toEqual([["PREVENTIVE", 1500], ["CORRECTIVE", 3200]]);
  });

  it("imported unit codes work in WhatsApp registration, written differently", async () => {
    if (!dbUp) return;
    const stranger = `+2012${Date.now().toString().slice(-8)}`;
    const [m1] = await getMockWhatsAppProvider().receiveMessage({ from: stranger, type: "text", text: "السلام عليكم" });
    await handleInboundMessage(m1, "mock");
    const [m2] = await getMockWhatsAppProvider().receiveMessage({ from: stranger, type: "text", text: `${TAG.toLowerCase()}v-12` });
    await handleInboundMessage(m2, "mock");
    const res = await db.resident.findUniqueOrThrow({ where: { phone: stranger }, include: { unit: true } });
    expect(res.unit?.code).toBe(`${TAG}V 12`);
    await db.ticketMessage.deleteMany({ where: { conversation: { residentId: res.id } } });
    await db.conversation.deleteMany({ where: { residentId: res.id } });
    await db.resident.delete({ where: { id: res.id } });
  });
});

/**
 * MaintenanceOS demo seed — realistic Egyptian compound data.
 * Historical tickets are generated through the REAL engines (mock NLU → priority
 * engine → SLA engine) so the dashboard is consistent with live behaviour.
 *
 * Used by `pnpm db:seed` (prisma/seed.ts) and by the first-run bootstrap
 * (bootstrap.service.ts) on hosted deployments.
 */
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient, type Priority, type TicketStatus } from "@prisma/client";
import { CATEGORY_CATALOG, CATEGORY_BY_KEY } from "@/server/domain/categories";
import { formatTicketNumber } from "@/server/domain/constants";
import { evaluatePriority } from "@/server/engines/priority/priority-engine";
import { DEFAULT_SLA_POLICIES, computeSlaDeadlines } from "@/server/engines/sla/sla-engine";
import { computeQuotationTotals } from "@/server/engines/quotation/quotation-engine";
import { MockAIProvider } from "@/server/providers/ai/mock-ai.provider";

let db: PrismaClient;
const ai = new MockAIProvider();

// Deterministic PRNG so every seed produces the same demo
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
let NOW = Date.now();

const PASSWORD = "demo1234";

async function reset() {
  // Children first
  await db.notification.deleteMany();
  await db.quotationItem.deleteMany();
  await db.quotation.deleteMany();
  await db.assetMaintenance.deleteMany();
  await db.aIAnalysis.deleteMany();
  await db.ticketAttachment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticketMessage.deleteMany();
  await db.conversation.deleteMany();
  await db.ticket.deleteMany();
  await db.asset.deleteMany();
  await db.technician.deleteMany();
  await db.resident.deleteMany();
  await db.user.deleteMany();
  await db.contractor.deleteMany();
  await db.team.deleteMany();
  await db.unit.deleteMany();
  await db.building.deleteMany();
  await db.compound.deleteMany();
  await db.category.deleteMany();
  await db.slaPolicy.deleteMany();
  await db.$executeRawUnsafe(`ALTER SEQUENCE "Ticket_number_seq" RESTART WITH 101`);
}

async function main() {
  // SEED_IF_EMPTY=1 (used on hosted deploys): keep existing data across restarts
  if (process.env.SEED_IF_EMPTY === "1" && (await db.user.count()) > 0) {
    console.log("🌱 Database already seeded — skipping (SEED_IF_EMPTY=1)");
    return;
  }
  console.log("🌱 Seeding MaintenanceOS…");
  await reset();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ── SLA policies
  for (const [priority, p] of Object.entries(DEFAULT_SLA_POLICIES)) {
    await db.slaPolicy.create({
      data: { priority: priority as Priority, responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes, description: `${priority} default policy` },
    });
  }

  // ── Categories
  const categories: Record<string, { id: string; defaultResolutionMinutes: number }> = {};
  for (const [i, c] of CATEGORY_CATALOG.entries()) {
    const row = await db.category.create({
      data: {
        key: c.key,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        description: c.description,
        defaultResolutionMinutes: c.defaultResolutionMinutes,
        requiredSkill: c.requiredSkill,
        defaultPriority: c.defaultPriority,
        priorityRules: c.priorityRules as unknown as Prisma.InputJsonValue,
        quotationThreshold: c.quotationThreshold,
        icon: c.icon,
        sortOrder: i,
      },
    });
    categories[c.key] = row;
  }

  // ── Compound, buildings, units
  const compound = await db.compound.create({
    data: { name: "Palm Hills Demo Compound", nameAr: "كمبوند بالم هيلز التجريبي", city: "6th of October, Giza", address: "26th of July Corridor, Giza" },
  });
  const buildings: Record<string, string> = {};
  const units: Record<string, string> = {};
  for (const code of ["A01", "A02", "A03"]) {
    const b = await db.building.create({ data: { compoundId: compound.id, code, name: `Building ${code}`, floors: 5 } });
    buildings[code] = b.id;
    for (const floor of [1, 2, 3]) {
      for (const n of [1, 2]) {
        const unitCode = `${code}-${floor}0${n}`;
        const u = await db.unit.create({ data: { buildingId: b.id, code: unitCode, floor, type: n === 1 ? "Apartment" : "Duplex", areaSqm: n === 1 ? 165 : 210 } });
        units[unitCode] = u.id;
      }
    }
  }

  // ── Management users
  const mkUser = (email: string, name: string, nameAr: string, role: Prisma.UserCreateInput["role"], phone: string, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) =>
    db.user.create({ data: { email, name, nameAr, role, phone, passwordHash, compoundId: compound.id, locale: "en", ...extra } });

  await mkUser("admin@demo.com", "System Admin", "مدير النظام", "ADMIN", "+201000000001");
  await mkUser("manager@demo.com", "Hany Mostafa", "هاني مصطفى", "COMPOUND_MANAGER", "+201000000002");
  const maintManager = await mkUser("maintenance@demo.com", "Karim Adel", "كريم عادل", "MAINTENANCE_MANAGER", "+201000000003");

  // ── Teams
  const teamDefs = [
    { name: "Plumbing Team", nameAr: "فريق السباكة", cat: "PLUMBING" },
    { name: "HVAC Team", nameAr: "فريق التكييف", cat: "HVAC" },
    { name: "Electrical Team", nameAr: "فريق الكهرباء", cat: "ELECTRICAL" },
    { name: "Civil & Finishing Team", nameAr: "فريق الأعمال المدنية", cat: "CIVIL" },
    { name: "General Services", nameAr: "الخدمات العامة", cat: "OTHER" },
  ];
  const teams: Record<string, string> = {};
  for (const t of teamDefs) {
    const row = await db.team.create({ data: { name: t.name, nameAr: t.nameAr, compoundId: compound.id, categoryId: categories[t.cat].id } });
    teams[t.cat] = row.id;
  }

  // ── Technicians
  const techDefs = [
    { email: "ahmed@demo.com", name: "Ahmed Hassan", nameAr: "أحمد حسن", skills: ["PLUMBING"], team: "PLUMBING", status: "AVAILABLE" as const, rating: 4.7 },
    { email: "mohamed@demo.com", name: "Mohamed Ali", nameAr: "محمد علي", skills: ["HVAC", "APPLIANCES"], team: "HVAC", status: "AVAILABLE" as const, rating: 4.8 },
    { email: "omar@demo.com", name: "Omar Khaled", nameAr: "عمر خالد", skills: ["ELECTRICAL", "SECURITY"], team: "ELECTRICAL", status: "AVAILABLE" as const, rating: 4.6 },
    { email: "tarek@demo.com", name: "Tarek Fawzy", nameAr: "طارق فوزي", skills: ["PLUMBING", "CIVIL"], team: "PLUMBING", status: "BUSY" as const, rating: 4.3 },
    { email: "mahmoud@demo.com", name: "Mahmoud Saeed", nameAr: "محمود سعيد", skills: ["HVAC", "APPLIANCES"], team: "HVAC", status: "AVAILABLE" as const, rating: 4.4 },
    { email: "youssef@demo.com", name: "Youssef Ibrahim", nameAr: "يوسف إبراهيم", skills: ["CARPENTRY", "PAINTING", "GENERAL"], team: "CIVIL", status: "AVAILABLE" as const, rating: 4.5 },
    { email: "sayed@demo.com", name: "Sayed Abdelrahman", nameAr: "سيد عبد الرحمن", skills: ["CLEANING", "LANDSCAPING", "GENERAL"], team: "OTHER", status: "AVAILABLE" as const, rating: 4.2 },
    { email: "khaled.n@demo.com", name: "Khaled Nabil", nameAr: "خالد نبيل", skills: ["ELECTRICAL"], team: "ELECTRICAL", status: "OFF_DUTY" as const, rating: 4.1 },
  ];
  const techs: { id: string; name: string; skills: string[]; userId: string; status: string }[] = [];
  for (const [i, t] of techDefs.entries()) {
    const u = await mkUser(t.email, t.name, t.nameAr, "TECHNICIAN", `+20111000000${i + 1}`);
    const row = await db.technician.create({
      data: { userId: u.id, teamId: teams[t.team], name: t.name, nameAr: t.nameAr, phone: u.phone!, skills: t.skills, status: t.status, rating: t.rating, maxConcurrent: 5 },
    });
    techs.push({ id: row.id, name: t.name, skills: t.skills, userId: u.id, status: t.status });
  }

  // ── Contractors
  const contractorDefs = [
    { name: "ABC Maintenance", nameAr: "إيه بي سي للصيانة", cat: "CIVIL", rating: 4.2 },
    { name: "Nile HVAC", nameAr: "النيل للتكييف", cat: "HVAC", rating: 4.6 },
    { name: "Cairo Plumbing", nameAr: "القاهرة للسباكة", cat: "PLUMBING", rating: 4.1 },
    { name: "Delta Lifts", nameAr: "دلتا للمصاعد", cat: "ELEVATOR", rating: 4.5 },
    { name: "Giza Electric Co.", nameAr: "الجيزة للكهرباء", cat: "ELECTRICAL", rating: 3.9 },
    { name: "Green Oasis Landscaping", nameAr: "الواحة الخضراء للاندسكيب", cat: "LANDSCAPING", rating: 4.4 },
    { name: "SafeGate Security Systems", nameAr: "سيف جيت لأنظمة الأمن", cat: "SECURITY", rating: 4.0 },
  ];
  const contractors: Record<string, { id: string; name: string }> = {};
  for (const [i, c] of contractorDefs.entries()) {
    const row = await db.contractor.create({
      data: { name: c.name, nameAr: c.nameAr, categoryId: categories[c.cat].id, phone: `+20122000000${i + 1}`, email: `ops@${c.name.toLowerCase().replace(/[^a-z]/g, "")}.example`, rating: c.rating },
    });
    contractors[c.cat] = row;
  }
  await mkUser("contractor@demo.com", "Nile HVAC Dispatcher", "مسؤول النيل للتكييف", "CONTRACTOR", "+201220000099", { contractorId: contractors.HVAC.id });

  // ── Residents
  const residentDefs = [
    { name: "Mona Abdelaziz", nameAr: "منى عبد العزيز", unit: "A01-101", lang: "ar" },
    { name: "Khaled Mansour", nameAr: "خالد منصور", unit: "A01-102", lang: "ar" },
    { name: "Sara El-Sayed", nameAr: "سارة السيد", unit: "A01-201", lang: "ar" },
    { name: "Tamer Selim", nameAr: "تامر سليم", unit: "A01-301", lang: "ar" },
    { name: "Nadia Hamdy", nameAr: "نادية حمدي", unit: "A02-101", lang: "ar" },
    { name: "John Matthews", nameAr: "جون ماثيوز", unit: "A02-102", lang: "en" },
    { name: "Youssef Farouk", nameAr: "يوسف فاروق", unit: "A02-201", lang: "ar" },
    { name: "Amr Shawky", nameAr: "عمرو شوقي", unit: "A02-302", lang: "ar" },
    { name: "Heba Ragab", nameAr: "هبة رجب", unit: "A03-101", lang: "ar" },
    { name: "Mostafa Kamel", nameAr: "مصطفى كامل", unit: "A03-202", lang: "ar" },
    { name: "Rania Fathy", nameAr: "رانيا فتحي", unit: "A03-301", lang: "ar" },
  ];
  const residents: { id: string; unit: string; unitId: string; name: string; phone: string }[] = [];
  for (const [i, r] of residentDefs.entries()) {
    const phone = `+2010${String(10000000 + i * 1111 + 1234).slice(0, 8)}`;
    const user =
      i === 0
        ? await mkUser("resident@demo.com", r.name, r.nameAr, "RESIDENT", phone, { locale: "ar" })
        : null;
    const row = await db.resident.create({
      data: { name: r.name, nameAr: r.nameAr, unitId: units[r.unit], phone, language: r.lang, userId: user?.id, email: `${r.name.split(" ")[0].toLowerCase()}@example.com` },
    });
    residents.push({ id: row.id, unit: r.unit, unitId: units[r.unit], name: r.nameAr, phone });
  }

  // ── Assets
  const assetsByUnit: Record<string, { id: string; code: string; type: string; location: string }[]> = {};
  const mkAsset = async (a: {
    code: string; name: string; nameAr: string; type: string; cat: string; location: string; unit?: string; building?: string;
    installYearsAgo: number; manufacturer: string; model: string; warrantyYears: number; status?: Prisma.AssetCreateInput["status"];
  }) => {
    const installed = new Date(NOW - a.installYearsAgo * 365 * DAY);
    const row = await db.asset.create({
      data: {
        assetCode: a.code, name: a.name, nameAr: a.nameAr, type: a.type, compoundId: compound.id,
        buildingId: a.building ? buildings[a.building] : a.unit ? buildings[a.unit.slice(0, 3)] : null,
        unitId: a.unit ? units[a.unit] : null, categoryId: categories[a.cat].id, location: a.location,
        installationDate: installed, manufacturer: a.manufacturer, model: a.model,
        serialNumber: `SN-${a.code.replace(/-/g, "")}-${Math.floor(rand() * 90000 + 10000)}`,
        warrantyExpiry: new Date(installed.getTime() + a.warrantyYears * 365 * DAY), status: a.status ?? "OPERATIONAL",
      },
    });
    const key = a.unit ?? `B:${a.building}`;
    (assetsByUnit[key] ??= []).push({ id: row.id, code: a.code, type: a.type, location: a.location });
    return row;
  };
  const acBrands = [["Carrier", "Optimax 1.5HP"], ["Sharp", "AH-A12 Inverter"], ["LG", "Dual Cool 2.25HP"], ["Unionaire", "Artify 1.5HP"]];
  for (const r of residents) {
    const [m, mo] = pick(acBrands);
    await mkAsset({ code: `AC-${r.unit}-LR`, name: "Split AC – Living room", nameAr: "تكييف سبليت – الصالة", type: "AC", cat: "HVAC", location: "Living room", unit: r.unit, installYearsAgo: 2 + Math.floor(rand() * 4), manufacturer: m, model: mo, warrantyYears: 3 });
    if (["A01-201", "A02-201", "A03-301"].includes(r.unit)) {
      await mkAsset({ code: `AC-${r.unit}-BR`, name: "Split AC – Bedroom", nameAr: "تكييف سبليت – غرفة النوم", type: "AC", cat: "HVAC", location: "Bedroom", unit: r.unit, installYearsAgo: 1 + Math.floor(rand() * 3), manufacturer: m, model: mo, warrantyYears: 3 });
    }
    if (["A01-101", "A01-201", "A02-101", "A02-201", "A03-101"].includes(r.unit)) {
      await mkAsset({ code: `WH-${r.unit}`, name: "Electric water heater", nameAr: "سخان كهرباء", type: "Water Heater", cat: "APPLIANCES", location: "Bathroom", unit: r.unit, installYearsAgo: 3, manufacturer: "Olympic Electric", model: "Hero 50L", warrantyYears: 2 });
    }
  }
  for (const b of ["A01", "A02", "A03"]) {
    await mkAsset({ code: `ELV-${b}`, name: `Elevator ${b}`, nameAr: `أسانسير ${b}`, type: "Elevator", cat: "ELEVATOR", location: "Lobby", building: b, installYearsAgo: 5, manufacturer: "Schindler", model: "3300", warrantyYears: 2 });
  }
  await mkAsset({ code: "PMP-A01", name: "Booster water pump", nameAr: "طلمبة رفع المياه", type: "Water Pump", cat: "PLUMBING", location: "Basement", building: "A01", installYearsAgo: 4, manufacturer: "Grundfos", model: "CR 10-5", warrantyYears: 2 });
  await mkAsset({ code: "GEN-01", name: "Standby generator 250 kVA", nameAr: "مولد كهرباء احتياطي", type: "Generator", cat: "ELECTRICAL", location: "Utility yard", building: "A02", installYearsAgo: 6, manufacturer: "Perkins", model: "250kVA", warrantyYears: 3 });
  await mkAsset({ code: "EP-A02", name: "Main electrical panel A02", nameAr: "لوحة الكهرباء الرئيسية A02", type: "Electrical Panel", cat: "ELECTRICAL", location: "Electrical room", building: "A02", installYearsAgo: 5, manufacturer: "Schneider Electric", model: "Prisma G", warrantyYears: 5 });
  await mkAsset({ code: "GATE-01", name: "Main vehicle gate", nameAr: "البوابة الرئيسية", type: "Gate", cat: "SECURITY", location: "Main gate", building: "A01", installYearsAgo: 4, manufacturer: "CAME", model: "BX-243", warrantyYears: 2, status: "NEEDS_ATTENTION" });
  await mkAsset({ code: "DOOR-A03-ENT", name: "Building entrance door A03", nameAr: "باب مدخل عمارة A03", type: "Door", cat: "CARPENTRY", location: "Entrance", building: "A03", installYearsAgo: 4, manufacturer: "Local", model: "Steel/Glass", warrantyYears: 1 });

  // Preventive maintenance history (e.g. AC compressor inspection, gas refill)
  const allAssets = await db.asset.findMany();
  for (const a of allAssets) {
    const entries = a.type === "AC" ? 2 : a.type === "Elevator" ? 3 : 1;
    for (let i = 0; i < entries; i++) {
      const daysAgo = 20 + i * 30 + Math.floor(rand() * 10);
      const desc =
        a.type === "AC" ? pick(["Compressor inspection", "Filter cleaning & gas pressure check", "Gas refill (R410)"]) :
        a.type === "Elevator" ? pick(["Monthly preventive maintenance", "Door sensor calibration", "Rope & brake inspection"]) :
        a.type === "Generator" ? "Load test & oil change" :
        a.type === "Water Pump" ? "Pressure switch check" : "Annual inspection";
      await db.assetMaintenance.create({
        data: { assetId: a.id, date: new Date(NOW - daysAgo * DAY), type: desc.includes("Gas refill") ? "CORRECTIVE" : "PREVENTIVE", description: desc, cost: Math.round(150 + rand() * 900), performedBy: a.type === "Elevator" ? "Delta Lifts" : pick(techs).name },
      });
    }
  }

  // ── Historical tickets (through the real engines)
  const requests: { text: string; status: TicketStatus; daysAgo: number; quote?: boolean; breach?: boolean }[] = [
    { text: "التكييف في الصالة مش بيبرد", status: "CLOSED", daysAgo: 44 },
    { text: "الحنفية في المطبخ بتسرب", status: "CLOSED", daysAgo: 42 },
    { text: "اللمبة في المدخل اتحرقت", status: "CLOSED", daysAgo: 40 },
    { text: "الأسانسير واقف في الدور التالت ومفيش حد جوه", status: "CLOSED", daysAgo: 38, breach: true },
    { text: "السخان مش شغال ومفيش مية سخنة", status: "CLOSED", daysAgo: 36, quote: true },
    { text: "الباب مش بيقفل كويس", status: "CLOSED", daysAgo: 33 },
    { text: "فيه ماسورة انفجرت في الحمام والمياه كتير", status: "CLOSED", daysAgo: 31 },
    { text: "الكهربا قاطعة في الشقة", status: "CLOSED", daysAgo: 29 },
    { text: "التكييف بينقط ميه في أوضة النوم", status: "CLOSED", daysAgo: 27 },
    { text: "المياه ضعيفة جدا في الدش", status: "CLOSED", daysAgo: 25, breach: true },
    { text: "البلاعة في الحمام مسدودة", status: "CLOSED", daysAgo: 23 },
    { text: "عايز دهان للحيطة في الصالة فيها رطوبة", status: "CLOSED", daysAgo: 21, quote: true },
    { text: "The AC in the living room makes a loud noise", status: "CLOSED", daysAgo: 19 },
    { text: "الفيشة في المطبخ بتطلع شرار", status: "CLOSED", daysAgo: 17 },
    { text: "كاميرا البوابة مش شغالة", status: "CLOSED", daysAgo: 15 },
    { text: "الكمبروسر بتاع التكييف عطلان", status: "CLOSED", daysAgo: 13, quote: true },
    { text: "شجرة وقعت جنب الجراج", status: "CLOSED", daysAgo: 11 },
    { text: "السيفون في الحمام بيسرب", status: "COMPLETED", daysAgo: 6 },
    { text: "ضلفة الدولاب في المطبخ مكسورة", status: "COMPLETED", daysAgo: 5 },
    { text: "Water heater is not working", status: "COMPLETED", daysAgo: 4, quote: true },
    { text: "فيه صراصير كتير في السلم", status: "CANCELLED", daysAgo: 9 },
    { text: "التكييف مش شغال خالص", status: "WAITING_APPROVAL", daysAgo: 3, quote: true },
    { text: "البوابة الرئيسية مش بتفتح", status: "WAITING_APPROVAL", daysAgo: 2, quote: true },
    { text: "شرخ في سقف الحمام", status: "IN_PROGRESS", daysAgo: 3, breach: true },
    { text: "السكينة بتفصل كل شوية", status: "IN_PROGRESS", daysAgo: 1.2 },
    { text: "المياه بتسرب من سقف المطبخ", status: "IN_PROGRESS", daysAgo: 0.3 },
    { text: "الإنارة في الجنينة ضعيفة", status: "ACKNOWLEDGED", daysAgo: 1.5 },
    { text: "التكييف في أوضة النوم مش بيبرد", status: "ACKNOWLEDGED", daysAgo: 0.4 },
    { text: "الأسانسير بيعمل صوت عالي", status: "ASSIGNED", daysAgo: 0.6 },
    { text: "الحنفية بتسرب في الحمام", status: "ASSIGNED", daysAgo: 0.15, breach: true },
    { text: "الفيشة في أوضة النوم مش شغالة", status: "ASSIGNED", daysAgo: 0.08 },
    { text: "فيه تسريب مياه في البلكونة", status: "WAITING_FOR_INFO", daysAgo: 0.05 },
    { text: "الكهربا قاطعة عن العمارة كلها", status: "NEW", daysAgo: 0.03 },
    { text: "النجيلة محتاجة قص والرشاشات مش شغالة", status: "NEW", daysAgo: 0.9 },
  ];

  const ORDER: TicketStatus[] = ["NEW", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_APPROVAL", "COMPLETED", "CLOSED"];
  const reached = (status: TicketStatus, step: TicketStatus) => {
    if (status === "CANCELLED") return step === "NEW" || step === "ASSIGNED";
    if (status === "WAITING_FOR_INFO") return step === "NEW";
    return ORDER.indexOf(status) >= ORDER.indexOf(step);
  };

  for (const [i, req] of requests.entries()) {
    const resident = residents[i % residents.length];
    const createdAt = new Date(NOW - req.daysAgo * DAY - Math.floor(rand() * 3) * HOUR);
    const known = [...(assetsByUnit[resident.unit] ?? []), ...(assetsByUnit[`B:${resident.unit.slice(0, 3)}`] ?? [])];
    const c = await ai.classifyMaintenanceRequest({
      text: req.text,
      knownAssets: known.map((a) => ({ assetCode: a.code, name: a.code, type: a.type, location: a.location })),
      disallowFollowUp: req.status !== "WAITING_FOR_INFO",
    });
    const def = CATEGORY_BY_KEY[c.category];
    const decision = evaluatePriority({ text: req.text, categoryDefault: def.defaultPriority, categoryRules: def.priorityRules, aiPriority: c.priority });
    const priority = decision.priority;
    const sla = computeSlaDeadlines({ priority, createdAt, categoryResolutionMinutes: def.defaultResolutionMinutes });
    const asset = c.assetCode ? known.find((a) => a.code === c.assetCode) : undefined;

    // Assignee
    const skill = def.requiredSkill;
    const isHistoric = ["CLOSED", "COMPLETED", "CANCELLED"].includes(req.status);
    const specialist = techs.filter((t) => t.skills.includes(skill) && (isHistoric || t.status !== "OFF_DUTY"));
    const useContractor = specialist.length === 0 || (req.quote && rand() < 0.35);
    const contractor = useContractor ? contractors[c.category] ?? null : null;
    const tech = contractor ? null : specialist.length ? pick(specialist) : techs.find((t) => t.skills.includes("GENERAL"))!;

    // Timeline
    const respWindow = sla.responseMinutes * MIN;
    const resWindow = sla.resolutionMinutes * MIN;
    const assignedAt = new Date(createdAt.getTime() + 2 * MIN);
    const ackAt = new Date(createdAt.getTime() + (req.breach ? respWindow * 1.4 : respWindow * (0.2 + rand() * 0.5)));
    const startAt = new Date(ackAt.getTime() + (10 + rand() * 50) * MIN);
    const completeAt = new Date(createdAt.getTime() + (req.breach ? resWindow * 1.3 : resWindow * (0.25 + rand() * 0.5)));
    const closeAt = new Date(completeAt.getTime() + (2 + rand() * 20) * HOUR);
    const cap = (d: Date) => (d.getTime() > NOW ? new Date(NOW - 5 * MIN) : d);

    const isAssigned = reached(req.status, "ASSIGNED") && req.status !== "WAITING_FOR_INFO";
    const acked = reached(req.status, "ACKNOWLEDGED") && req.status !== "CANCELLED";
    const started = reached(req.status, "IN_PROGRESS") && req.status !== "CANCELLED";
    const completed = req.status === "COMPLETED" || req.status === "CLOSED";

    let quoteTotal: number | null = null;
    let quoteItems: ReturnType<typeof computeQuotationTotals> | null = null;
    if (req.quote) {
      const material = c.category === "HVAC" ? ["Compressor 1.5HP", 4200] : c.category === "APPLIANCES" ? ["Heating element + thermostat", 950] : c.category === "SECURITY" ? ["Gate motor control board", 3800] : ["Waterproofing & paint materials", 1600];
      quoteItems = computeQuotationTotals([
        { type: "LABOR", description: "Labor", quantity: 2 + Math.floor(rand() * 3), unitPrice: 300 },
        { type: "MATERIAL", description: String(material[0]), quantity: 1, unitPrice: Number(material[1]) },
      ]);
      quoteTotal = quoteItems.total;
    }
    const finalCost = completed ? quoteTotal ?? Math.round(rand() < 0.4 ? 0 : 150 + rand() * 600) : null;

    const ticket = await db.ticket.create({
      data: {
        ticketNumber: `TMP-${i}`,
        compoundId: compound.id,
        residentId: resident.id,
        unitId: resident.unitId,
        title: c.title,
        description: req.text,
        location: c.location,
        categoryId: categories[c.category].id,
        priority,
        aiSuggestedPriority: c.priority,
        status: req.status,
        source: rand() < 0.85 ? "WHATSAPP" : "WEB",
        assetId: asset?.id ?? null,
        teamId: tech ? (await db.technician.findUnique({ where: { id: tech.id } }))!.teamId : null,
        technicianId: isAssigned ? tech?.id ?? null : null,
        contractorId: isAssigned ? contractor?.id ?? null : null,
        suggestedContractorId: !isAssigned && contractor ? contractor.id : null,
        requiresQuotation: !!req.quote,
        slaResponseDueAt: sla.responseDueAt,
        slaResolutionDueAt: sla.resolutionDueAt,
        slaResponseBreached: acked ? ackAt > sla.responseDueAt : !!req.breach && sla.responseDueAt.getTime() < NOW,
        slaResolutionBreached: completed ? completeAt > sla.resolutionDueAt : !!req.breach && sla.resolutionDueAt.getTime() < NOW,
        createdAt,
        assignedAt: isAssigned ? assignedAt : null,
        acknowledgedAt: acked ? cap(ackAt) : null,
        startedAt: started ? cap(startAt) : null,
        completedAt: completed ? cap(completeAt) : null,
        closedAt: req.status === "CLOSED" ? cap(closeAt) : null,
        cancelledAt: req.status === "CANCELLED" ? new Date(createdAt.getTime() + 3 * HOUR) : null,
        residentConfirmedAt: req.status === "CLOSED" ? cap(new Date(completeAt.getTime() + HOUR)) : null,
        estimatedCost: quoteTotal,
        approvedCost: req.quote && completed ? quoteTotal : null,
        finalCost,
        resolutionNotes: completed ? pick(["Replaced faulty part and tested.", "Fixed and verified with resident.", "Issue resolved, area cleaned."]) : null,
      },
    });
    const ticketNumber = formatTicketNumber(ticket.number);
    await db.ticket.update({ where: { id: ticket.id }, data: { ticketNumber } });

    // AI analysis
    await db.aIAnalysis.create({
      data: {
        ticketId: ticket.id, provider: "mock", model: "rules-nlu-v1", input: req.text, language: c.language, categoryKey: c.category,
        priority: c.priority, issue: c.issue, location: c.location, assetHint: asset?.code ?? c.assetType, confidence: c.confidence,
        recommendedAction: c.recommendedAction, reasoning: c.reasoning, needsMoreInfo: c.needsMoreInfo, followUpQuestion: c.followUpQuestion,
        entities: { issueAr: c.issueAr, severity: c.severity, assetType: c.assetType, assetCode: asset?.code ?? null, priorityDecision: { source: decision.source, reasons: decision.reasons } },
        latencyMs: 4 + Math.floor(rand() * 10), createdAt: new Date(createdAt.getTime() + 2000),
      },
    });

    // Events
    const ev = (type: Prisma.TicketEventCreateManyInput["type"], at: Date, actorType: Prisma.TicketEventCreateManyInput["actorType"], actorName: string, message: string, data?: Prisma.InputJsonValue) =>
      ({ ticketId: ticket.id, type, createdAt: at, actorType, actorName, message, data });
    const sec = (n: number) => new Date(createdAt.getTime() + n * 1000);
    const assigneeName = tech?.name ?? contractor?.name ?? "—";
    const events: Prisma.TicketEventCreateManyInput[] = [
      ev("TICKET_CREATED", createdAt, "RESIDENT", resident.name, `Ticket ${ticketNumber} created via WHATSAPP`),
      ev("AI_ANALYZING", sec(1), "AI", "AI Assistant", "AI analysis started"),
      ev("AI_ANALYZED", sec(2), "AI", "AI Assistant", `AI classified as ${def.nameEn} · ${c.issue} (${Math.round(c.confidence * 100)}% confidence)`),
      ev("PRIORITY_CHANGED", sec(2), "SYSTEM", "MaintenanceOS", `Priority set to ${priority} by priority engine`, { reasons: decision.reasons }),
      ev("SLA_SET", sec(2), "SYSTEM", "MaintenanceOS", `SLA: respond within ${sla.responseMinutes} min, resolve within ${Math.round(sla.resolutionMinutes / 60)} h`),
    ];
    if (req.status === "WAITING_FOR_INFO") events.push(ev("INFO_REQUESTED", sec(3), "AI", "AI Assistant", `AI asked: ${c.followUpQuestion}`));
    if (!isAssigned && contractor && req.status === "NEW") events.push(ev("NOTE_ADDED", sec(3), "SYSTEM", "MaintenanceOS", `Suggested contractor ${contractor.name} — awaiting manager confirmation`));
    if (isAssigned) events.push(ev("ASSIGNED", assignedAt, contractor ? "STAFF" : "SYSTEM", contractor ? "Karim Adel" : "MaintenanceOS", contractor ? `Assigned to ${assigneeName} by Karim Adel` : `Auto-assigned to ${assigneeName}`));
    if (acked) events.push(ev("ACKNOWLEDGED", cap(ackAt), contractor ? "CONTRACTOR" : "TECHNICIAN", assigneeName, `${assigneeName} acknowledged the job`));
    if (req.breach && (ackAt > sla.responseDueAt || !acked) && sla.responseDueAt.getTime() < NOW) events.push(ev("SLA_BREACHED", sla.responseDueAt, "SYSTEM", "MaintenanceOS", "Response SLA breached — ticket not acknowledged in time"));
    if (started) events.push(ev("STARTED", cap(startAt), contractor ? "CONTRACTOR" : "TECHNICIAN", assigneeName, `${assigneeName} started work`));
    if (req.status === "CANCELLED") events.push(ev("CANCELLED", new Date(createdAt.getTime() + 3 * HOUR), "STAFF", "Karim Adel", "Karim Adel cancelled the ticket: handled by pest-control vendor contract"));

    // Quotation
    if (req.quote && quoteItems && (started || req.status === "WAITING_APPROVAL")) {
      const quoteAt = cap(new Date(startAt.getTime() + 40 * MIN));
      const approved = completed;
      await db.quotation.create({
        data: {
          ticketId: ticket.id, number: `Q-${ticketNumber.replace("MAINT-", "")}-1`, version: 1, status: approved ? "APPROVED" : "SUBMITTED",
          contractorId: contractor?.id ?? null, createdByName: assigneeName, laborCost: quoteItems.laborCost, materialsCost: quoteItems.materialsCost,
          subtotal: quoteItems.subtotal, vatRate: quoteItems.vatRate, vatAmount: quoteItems.vatAmount, total: quoteItems.total, estimatedHours: 4,
          notes: "Part must be replaced — repair not economical.", createdAt: quoteAt,
          reviewedById: approved ? maintManager.id : null, reviewedByName: approved ? "Karim Adel" : null, reviewedAt: approved ? cap(new Date(quoteAt.getTime() + 2 * HOUR)) : null,
          items: { create: quoteItems.items.map((it) => ({ type: it.type, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total })) },
        },
      });
      events.push(ev("QUOTATION_CREATED", quoteAt, contractor ? "CONTRACTOR" : "TECHNICIAN", assigneeName, `Quotation submitted: ${quoteItems.total.toLocaleString("en-US")} EGP`));
      if (approved) events.push(ev("QUOTATION_APPROVED", cap(new Date(quoteAt.getTime() + 2 * HOUR)), "STAFF", "Karim Adel", `Karim Adel approved the quotation (${quoteItems.total.toLocaleString("en-US")} EGP)`));
    }
    if (completed) {
      events.push(ev("COMPLETED", cap(completeAt), contractor ? "CONTRACTOR" : "TECHNICIAN", assigneeName, `${assigneeName} completed the work`));
      if (asset) {
        await db.assetMaintenance.create({
          data: { assetId: asset.id, ticketId: ticket.id, date: cap(completeAt), type: priority === "EMERGENCY" ? "EMERGENCY" : "CORRECTIVE", description: c.title, cost: finalCost ?? 0, performedBy: assigneeName },
        });
        events.push(ev("ASSET_HISTORY_UPDATED", cap(completeAt), "SYSTEM", "MaintenanceOS", `Maintenance record added to asset ${asset.code}`));
      }
    }
    if (req.status === "CLOSED") {
      events.push(ev("RESIDENT_CONFIRMED", cap(new Date(completeAt.getTime() + HOUR)), "RESIDENT", resident.name, "Resident confirmed the issue is resolved"));
      events.push(ev("CLOSED", cap(closeAt), "STAFF", "Karim Adel", "Karim Adel closed the ticket"));
    }
    await db.ticketEvent.createMany({ data: events });

    // WhatsApp history
    const conv = await db.conversation.upsert({
      where: { residentId_channel: { residentId: resident.id, channel: "WHATSAPP" } },
      update: { lastMessageAt: createdAt },
      create: { residentId: resident.id, phone: resident.phone, channel: "WHATSAPP", lastMessageAt: createdAt, context: { provider: "mock" } },
    });
    await db.ticketMessage.createMany({
      data: [
        { conversationId: conv.id, ticketId: ticket.id, direction: "INBOUND", senderType: "RESIDENT", senderName: resident.name, body: req.text, status: "RECEIVED", provider: "mock", createdAt },
        {
          conversationId: conv.id, ticketId: ticket.id, direction: "OUTBOUND", senderType: "AI", senderName: "MaintenanceOS", provider: "mock", status: "SENT", createdAt: sec(3),
          body: req.status === "WAITING_FOR_INFO"
            ? `تمام، سجلت طلب صيانة رقم ${ticketNumber}. ${c.followUpQuestion}`
            : `تمام، سجلت طلب صيانة رقم ${ticketNumber} ✅\nالمشكلة: ${c.issueAr}\nالتصنيف: ${def.nameAr}`,
        },
        ...(completed ? [{ conversationId: conv.id, ticketId: ticket.id, direction: "OUTBOUND" as const, senderType: "AI" as const, senderName: "MaintenanceOS", provider: "mock", status: "SENT" as const, createdAt: cap(completeAt), body: `تم الانتهاء من طلب الصيانة رقم ${ticketNumber} ✅` }] : []),
      ],
    });
    if (req.status === "WAITING_FOR_INFO") {
      await db.conversation.update({ where: { id: conv.id }, data: { state: "AWAITING_INFO", activeTicketId: ticket.id, context: { provider: "mock", questionsAsked: 1, pendingQuestion: c.followUpQuestion } } });
    }
    if (asset && ["IN_PROGRESS", "ACKNOWLEDGED", "ASSIGNED", "WAITING_APPROVAL"].includes(req.status)) {
      await db.asset.update({ where: { id: asset.id }, data: { status: req.status === "IN_PROGRESS" ? "UNDER_MAINTENANCE" : "NEEDS_ATTENTION" } });
    }
  }
  // Conversations end idle unless waiting for info; residents who completed recently are not mid-confirmation.

  // Contractor cached metrics
  for (const c of Object.values(contractors)) {
    const done = await db.ticket.findMany({ where: { contractorId: c.id, completedAt: { not: null } } });
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    await db.contractor.update({
      where: { id: c.id },
      data: {
        completedJobs: done.length + Math.floor(rand() * 12) + 3,
        avgResponseMinutes: done.length ? avg(done.map((t) => ((t.acknowledgedAt ?? t.createdAt).getTime() - t.createdAt.getTime()) / MIN)) : 45 + Math.floor(rand() * 90),
        avgResolutionMinutes: done.length ? avg(done.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / MIN)) : 600 + Math.floor(rand() * 1400),
        totalCost: done.reduce((s2, t) => s2 + Number(t.finalCost ?? 0), 0) + Math.round(rand() * 20000 + 5000),
      },
    });
  }

  // Welcome notifications
  const managers = await db.user.findMany({ where: { role: { in: ["MAINTENANCE_MANAGER", "COMPOUND_MANAGER", "ADMIN"] } } });
  const pendingApprovals = await db.ticket.findMany({ where: { status: "WAITING_APPROVAL" } });
  for (const m of managers) {
    for (const t of pendingApprovals) {
      await db.notification.create({ data: { userId: m.id, role: m.role, title: `Approval needed: ${t.ticketNumber}`, body: t.title, link: `/tickets/${t.id}`, ticketId: t.id, createdAt: t.updatedAt } });
    }
  }

  const counts = {
    tickets: await db.ticket.count(),
    assets: await db.asset.count(),
    contractors: await db.contractor.count(),
    residents: await db.resident.count(),
    technicians: await db.technician.count(),
    events: await db.ticketEvent.count(),
  };
  console.log("✅ Seed complete", counts);
  console.log(`\nDemo logins (password: ${PASSWORD})\n  manager@demo.com      Compound Manager\n  maintenance@demo.com  Maintenance Manager\n  ahmed@demo.com        Technician (Plumbing)\n  mohamed@demo.com      Technician (HVAC)\n  omar@demo.com         Technician (Electrical)\n  contractor@demo.com   Contractor (Nile HVAC)\n  resident@demo.com     Resident\n  admin@demo.com        Admin`);
}


/** Wipes and recreates the demo dataset. */
export async function seedDemo(client: PrismaClient) {
  db = client;
  s = 42;
  NOW = Date.now();
  await main();
}

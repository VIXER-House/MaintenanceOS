/**
 * What each import type looks like: columns (English/Arabic titles + accepted aliases),
 * how one row is read and checked, and how duplicates inside the file are detected.
 * Pure — used by the browser preview and re-run by the server before saving.
 */
import { cleanUnitCode, normalizeUnitCode } from "@/server/domain/unit-codes";
import {
  hasArabic,
  normalizeAnyPhone,
  normalizePhoneNumber,
  parseBool,
  parseChoice,
  parseDate,
  parseNumber,
  splitList,
  type ColumnDef,
  type ImportIssue,
  type ImportType,
  type RawRow,
} from "./core";

type Values = Record<string, unknown>;
export interface ParsedRow {
  row: number;
  value: Values;
}

export interface ImportDefinition {
  type: ImportType;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  /** What identifies a record, shown to the user ("Re-importing updates by …") */
  matchBy: { en: string; ar: string };
  columns: ColumnDef[];
  parseRow(raw: RawRow, err: (field: string, message: string) => void, warn: (field: string, message: string) => void): Values | null;
  /** Key for "same record twice in this file" */
  fileKey(v: Values): string;
  duplicateLevel?: "error" | "warning";
  /** Rows sharing `key` must agree on `value` (e.g. a unit can only be in one building) */
  consistency?: { key: (v: Values) => string; value: (v: Values) => string; field: string; message: (other: string, row: number) => string };
  /** Short label of a parsed row for the preview table */
  label(v: Values): { main: string; sub?: string; extra?: string };
}

const col = (c: Omit<ColumnDef, "aliases"> & { aliases?: string[] }): ColumnDef => ({ aliases: [], ...c });

// Shared column sets
const BUILDING = col({ field: "building", header: "Building / المبنى", aliases: ["building", "buildingcode", "block", "zone", "مبنى", "عمارة", "العمارة", "عماره", "العماره", "البلوك"], width: 14, text: true, examples: ["A01", "A01", "V"] });
const UNIT = (required: boolean) =>
  col({ field: "unit", header: "Unit code / رقم الوحدة", required, aliases: ["unit", "unitcode", "unitno", "unitnumber", "apartment", "villa", "الوحدة", "الوحده", "وحدة", "رقمالوحده", "الشقة", "رقمالشقه"], width: 18, text: true, examples: ["A01-101", "A01-101", "V-12"] });
const FLOOR = col({ field: "floor", header: "Floor / الدور", aliases: ["floor", "الدور", "دور", "الطابق"], width: 10, examples: ["1", "1", "0"] });
const UNIT_TYPE = col({ field: "unitType", header: "Unit type / نوع الوحدة", aliases: ["unittype", "type", "نوعالوحده"], width: 16, examples: ["Apartment", "Apartment", "Villa"] });
const CATEGORY = (required: boolean, examples: string[]) =>
  col({ field: "category", header: "Category / التصنيف", required, aliases: ["category", "trade", "specialty", "التصنيف", "التخصص", "النشاط", "القسم"], width: 18, examples });
const EMAIL = col({ field: "email", header: "Email / البريد", aliases: ["email", "e-mail", "mail", "البريد", "البريدالالكتروني", "الايميل"], width: 24, examples: ["", "", ""] });

function readFloor(raw: string, warn: (f: string, m: string) => void): number {
  if (!raw) return 0;
  if (/^(g|gf|ground|ارضي|الارضي|أرضي)$/i.test(raw.trim())) return 0;
  const f = Number.parseInt(raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))), 10);
  if (Number.isFinite(f) && f >= -5 && f <= 200) return f;
  warn("floor", "Floor not understood — 0 used");
  return 0;
}

/** Building for a NEW unit: given, or the part before the last separator ("A01-101" → "A01", "V 14" → "V"). */
function buildingFor(unit: string, given: string): string {
  if (given) return cleanUnitCode(given);
  return unit.match(/^(.+?)\s*[-/\\\s]\s*[^-/\\\s]+$/)?.[1] ?? "";
}

function readDate(raw: string, field: string, err: (f: string, m: string) => void): string | null {
  const d = parseDate(raw);
  if (d === "invalid") {
    err(field, "Date not understood — use 2024-03-15 or 15/03/2024");
    return null;
  }
  return d ? d.toISOString().slice(0, 10) : null;
}

const MAINTENANCE_TYPES = {
  PREVENTIVE: ["preventive", "pm", "scheduled", "وقائي", "وقائية", "دوري", "دورية"],
  CORRECTIVE: ["corrective", "repair", "fix", "اصلاح", "إصلاح", "تصليح", "علاجي"],
  INSPECTION: ["inspection", "check", "visit", "فحص", "معاينة", "معاينه", "زيارة"],
  EMERGENCY: ["emergency", "urgent", "طوارئ", "طارئ", "طارئة"],
} as const;

const ASSET_STATUS = {
  OPERATIONAL: ["ok", "working", "active", "يعمل", "شغال", "سليم"],
  NEEDS_ATTENTION: ["attention", "needs attention", "يحتاج متابعة", "متابعة"],
  UNDER_MAINTENANCE: ["maintenance", "under maintenance", "تحت الصيانة", "صيانة"],
  OUT_OF_SERVICE: ["out of service", "broken", "down", "عطلان", "معطل", "متوقف"],
  RETIRED: ["retired", "removed", "مستبعد", "تم الاستبعاد", "خارج الخدمة نهائيا"],
} as const;

const TECH_STATUS = {
  AVAILABLE: ["available", "active", "متاح", "متاحة", "شغال"],
  BUSY: ["busy", "مشغول"],
  OFF_DUTY: ["off", "off duty", "leave", "vacation", "اجازة", "إجازة", "غير متاح"],
} as const;

export const IMPORT_DEFINITIONS: Record<ImportType, ImportDefinition> = {
  // ───────────────────────── residents ─────────────────────────
  residents: {
    type: "residents",
    title: { en: "Residents", ar: "السكان" },
    description: { en: "Owners, family members and tenants with their units — the WhatsApp bot recognises them by mobile number.", ar: "الملاك وأفراد الأسرة والمستأجرين ووحداتهم — بوت واتساب بيتعرف عليهم برقم الموبايل." },
    matchBy: { en: "mobile number", ar: "رقم الموبايل" },
    columns: [
      BUILDING,
      UNIT(true),
      FLOOR,
      UNIT_TYPE,
      col({ field: "name", header: "Resident name / الاسم", required: true, aliases: ["name", "residentname", "fullname", "nameen", "englishname", "الاسم", "اسمالساكن", "الاسمبالانجليزي"], width: 24, examples: ["Ahmed Hassan", "Mona Ali", "Karim Adel"] }),
      col({ field: "nameAr", header: "Arabic name / الاسم بالعربي", aliases: ["namear", "arabicname", "الاسمبالعربي", "الاسمعربي"], width: 24, examples: ["أحمد حسن", "منى علي", "كريم عادل"] }),
      col({ field: "phone", header: "Mobile / الموبايل", required: true, aliases: ["phone", "mobile", "phonenumber", "mobilenumber", "whatsapp", "tel", "الموبايل", "موبايل", "رقمالموبايل", "الهاتف", "رقمالهاتف", "واتساب", "تليفون", "الجوال"], width: 18, text: true, examples: ["01012345678", "+201112345678", "01223456789"] }),
      col({ field: "role", header: "Owner or tenant / مالك أو مستأجر", aliases: ["ownerortenant", "role", "residenttype", "relation", "مالكاومستاجر", "الصفه", "صفه"], width: 22, examples: ["owner", "owner", "tenant"], list: ["owner", "tenant"] }),
      col({ field: "language", header: "Language / اللغة", aliases: ["language", "lang", "اللغه"], width: 12, examples: ["ar", "ar", "en"], list: ["ar", "en"] }),
      EMAIL,
    ],
    parseRow({ values: v }, err, warn) {
      let ok = true;
      const phone = normalizePhoneNumber(v.phone ?? "");
      if (!v.phone) (ok = false), err("phone", "Mobile number is missing");
      else if (!phone) (ok = false), err("phone", "Not a valid mobile number (Egypt: 01XXXXXXXXX, other countries: +country code)");
      const name = (v.name ?? "").replace(/\s+/g, " ");
      const nameArIn = (v.nameAr ?? "").replace(/\s+/g, " ");
      if (!name && !nameArIn) (ok = false), err("name", "Resident name is missing");
      const unit = cleanUnitCode(v.unit ?? "");
      if (!normalizeUnitCode(unit)) (ok = false), err("unit", "Unit code is missing");
      let isOwner = parseChoice(v.role ?? "", { owner: ["مالك", "المالك", "ملك", "تمليك"], tenant: ["renter", "مستأجر", "المستأجر", "ايجار", "إيجار", "ساكن"] }, "owner");
      if (isOwner === "invalid") warn("role", "Use “owner” or “tenant” — owner used"), (isOwner = "owner");
      let language = parseChoice(v.language ?? "", { ar: ["arabic", "عربي", "العربية", "عربى"], en: ["english", "انجليزي", "إنجليزي", "الانجليزية"] }, "ar");
      if (language === "invalid") warn("language", "Use “ar” or “en” — ar used"), (language = "ar");
      let email: string | null = v.email || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warn("email", "Invalid email — ignored"), (email = null);
      if (!ok) return null;
      const nameAr = nameArIn || name;
      return {
        unit,
        building: buildingFor(unit, v.building ?? ""),
        floor: readFloor(v.floor ?? "", warn),
        unitType: v.unitType || "Apartment",
        name: name || nameAr,
        nameAr: hasArabic(nameAr) || !name ? nameAr : name,
        phone,
        isOwner: isOwner === "owner",
        language,
        email,
      };
    },
    fileKey: (v) => String(v.phone),
    consistency: {
      key: (v) => normalizeUnitCode(String(v.unit)),
      value: (v) => normalizeUnitCode(String(v.building)),
      field: "building",
      message: (other, row) => `This unit was given building ${other} in row ${row}`,
    },
    label: (v) => ({ main: String(v.nameAr), sub: v.name !== v.nameAr ? String(v.name) : undefined, extra: `${v.unit} · ${v.phone}` }),
  },

  // ───────────────────────── units ─────────────────────────
  units: {
    type: "units",
    title: { en: "Units & buildings", ar: "الوحدات والمباني" },
    description: { en: "Every unit in the compound, even empty ones — so new owners can register on WhatsApp later.", ar: "كل وحدات الكمبوند حتى الفاضية — عشان الملاك الجداد يقدروا يسجلوا على واتساب بعدين." },
    matchBy: { en: "unit code", ar: "رقم الوحدة" },
    columns: [
      BUILDING,
      UNIT(true),
      FLOOR,
      UNIT_TYPE,
      col({ field: "area", header: "Area m² / المساحة", aliases: ["area", "areasqm", "sqm", "size", "المساحه", "مساحه"], width: 14, examples: ["150", "180", "320"] }),
    ],
    parseRow({ values: v }, err, warn) {
      const unit = cleanUnitCode(v.unit ?? "");
      if (!normalizeUnitCode(unit)) return err("unit", "Unit code is missing"), null;
      let area = parseNumber(v.area ?? "");
      if (area === "invalid" || (typeof area === "number" && (area <= 0 || area > 100000))) warn("area", "Area not understood — ignored"), (area = null);
      return { unit, building: buildingFor(unit, v.building ?? ""), floor: v.floor ? readFloor(v.floor, warn) : null, unitType: v.unitType || "", area: area === null ? null : Math.round(area) };
    },
    fileKey: (v) => normalizeUnitCode(String(v.unit)),
    label: (v) => ({ main: String(v.unit), sub: `${v.building || "—"} · ${v.unitType || "—"}`, extra: v.area ? `${v.area} m²` : undefined }),
  },

  // ───────────────────────── technicians ─────────────────────────
  technicians: {
    type: "technicians",
    title: { en: "Technicians", ar: "الفنيين" },
    description: { en: "In-house technicians with their skills. Each new technician gets a login (shown once after the import).", ar: "فنيين الصيانة الداخليين ومهاراتهم. كل فني جديد بياخد حساب دخول (بيظهر مرة واحدة بعد الاستيراد)." },
    matchBy: { en: "mobile number", ar: "رقم الموبايل" },
    columns: [
      col({ field: "name", header: "Name / الاسم", required: true, aliases: ["name", "fullname", "technician", "الاسم", "اسمالفني", "الفني"], width: 22, examples: ["Mahmoud Saeed", "Tarek Fawzy", "Omar Khaled"] }),
      col({ field: "nameAr", header: "Arabic name / الاسم بالعربي", aliases: ["namear", "arabicname", "الاسمبالعربي"], width: 22, examples: ["محمود سعيد", "طارق فوزي", "عمر خالد"] }),
      col({ field: "phone", header: "Mobile / الموبايل", required: true, aliases: ["phone", "mobile", "الموبايل", "موبايل", "رقمالموبايل", "تليفون"], width: 16, text: true, examples: ["01001234567", "01101234567", "01201234567"] }),
      col({ field: "skills", header: "Skills / المهارات", required: true, aliases: ["skills", "skill", "trades", "specialty", "المهارات", "المهاره", "التخصص", "التخصصات"], width: 28, examples: ["HVAC", "Plumbing, Painting", "كهرباء"] }),
      col({ field: "team", header: "Team / الفريق", aliases: ["team", "group", "الفريق", "المجموعه"], width: 16, examples: ["HVAC Team", "Civil Team", "Electrical Team"] }),
      col({ field: "maxJobs", header: "Max open jobs / أقصى عدد مهام", aliases: ["maxjobs", "maxconcurrent", "capacity", "اقصيعددمهام", "السعه"], width: 18, examples: ["5", "6", "5"] }),
      col({ field: "status", header: "Status / الحالة", aliases: ["status", "الحاله"], width: 14, examples: ["available", "available", "off"], list: ["available", "busy", "off"] }),
      col({ field: "email", header: "Login email / بريد الدخول", aliases: ["email", "loginemail", "البريد", "الايميل"], width: 26, examples: ["", "", ""] }),
    ],
    parseRow({ values: v }, err, warn) {
      let ok = true;
      const name = (v.name ?? "").replace(/\s+/g, " ");
      if (!name) (ok = false), err("name", "Name is missing");
      const phone = normalizePhoneNumber(v.phone ?? "");
      if (!phone) (ok = false), err("phone", v.phone ? "Not a valid mobile number" : "Mobile number is missing");
      const skills = splitList(v.skills ?? "");
      if (!skills.length) (ok = false), err("skills", "At least one skill is needed (e.g. Plumbing, HVAC, كهرباء)");
      let maxJobs = parseNumber(v.maxJobs ?? "");
      if (maxJobs === "invalid" || (typeof maxJobs === "number" && (maxJobs < 1 || maxJobs > 50))) warn("maxJobs", "Use a number 1–50 — 5 used"), (maxJobs = null);
      let status = parseChoice(v.status ?? "", { AVAILABLE: [...TECH_STATUS.AVAILABLE], BUSY: [...TECH_STATUS.BUSY], OFF_DUTY: [...TECH_STATUS.OFF_DUTY] }, "AVAILABLE");
      if (status === "invalid") warn("status", "Use available / busy / off — available used"), (status = "AVAILABLE");
      let email: string | null = (v.email ?? "").toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warn("email", "Invalid email — one will be generated"), (email = null);
      if (!ok) return null;
      return { name, nameAr: v.nameAr || name, phone, skills, team: v.team || null, maxJobs: maxJobs === null ? 5 : Math.round(maxJobs), status, email };
    },
    fileKey: (v) => String(v.phone),
    label: (v) => ({ main: String(v.nameAr || v.name), sub: (v.skills as string[]).join(", "), extra: String(v.phone) }),
  },

  // ───────────────────────── contractors ─────────────────────────
  contractors: {
    type: "contractors",
    title: { en: "Contractors", ar: "المقاولين" },
    description: { en: "Outside companies you call for specialised work (elevators, HVAC, civil…).", ar: "الشركات الخارجية للأعمال المتخصصة (مصاعد، تكييف، أعمال مدنية…)." },
    matchBy: { en: "phone number", ar: "رقم التليفون" },
    columns: [
      col({ field: "name", header: "Company / الشركة", required: true, aliases: ["name", "company", "companyname", "contractor", "الشركه", "اسمالشركه", "المقاول", "الاسم"], width: 26, examples: ["CoolAir Services", "Lift Masters", "BuildFix"] }),
      col({ field: "nameAr", header: "Arabic name / الاسم بالعربي", aliases: ["namear", "arabicname", "الاسمبالعربي"], width: 24, examples: ["كول إير", "ليفت ماسترز", "بيلد فيكس"] }),
      CATEGORY(true, ["HVAC", "Elevator", "سباكة"]),
      col({ field: "phone", header: "Phone / التليفون", required: true, aliases: ["phone", "mobile", "tel", "التليفون", "الموبايل", "الهاتف", "رقمالتليفون"], width: 16, text: true, examples: ["0223456789", "01001112233", "01512345678"] }),
      EMAIL,
      col({ field: "active", header: "Active / فعال", aliases: ["active", "isactive", "فعال", "نشط"], width: 10, examples: ["yes", "yes", "no"], list: ["yes", "no"] }),
    ],
    parseRow({ values: v }, err, warn) {
      let ok = true;
      const name = (v.name ?? "").replace(/\s+/g, " ");
      if (!name) (ok = false), err("name", "Company name is missing");
      if (!v.category) (ok = false), err("category", "Category is missing");
      const phone = normalizeAnyPhone(v.phone ?? "");
      if (!phone) (ok = false), err("phone", v.phone ? "Not a valid phone number" : "Phone number is missing");
      let active = parseBool(v.active ?? "", true);
      if (active === "invalid") warn("active", "Use yes / no — yes used"), (active = true);
      let email: string | null = v.email || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warn("email", "Invalid email — ignored"), (email = null);
      if (!ok) return null;
      return { name, nameAr: v.nameAr || name, category: v.category, phone, email, isActive: active };
    },
    fileKey: (v) => String(v.phone),
    label: (v) => ({ main: String(v.nameAr || v.name), sub: String(v.category), extra: String(v.phone) }),
  },

  // ───────────────────────── assets ─────────────────────────
  assets: {
    type: "assets",
    title: { en: "Assets", ar: "الأصول" },
    description: { en: "Equipment you maintain — elevators, pumps, AC units, generators. Units/buildings must exist (import them first).", ar: "المعدات اللي بتتعمل لها صيانة — مصاعد، طلمبات، تكييفات، مولدات. لازم الوحدات/المباني تكون موجودة (استوردها الأول)." },
    matchBy: { en: "asset code", ar: "كود الأصل" },
    columns: [
      col({ field: "assetCode", header: "Asset code / كود الأصل", required: true, aliases: ["assetcode", "code", "tag", "assetid", "كودالاصل", "الكود", "كود"], width: 18, text: true, examples: ["ELV-A01-1", "PMP-MAIN-1", "AC-A01-101-LR"] }),
      col({ field: "name", header: "Name / الاسم", required: true, aliases: ["name", "assetname", "description", "الاسم", "اسمالاصل"], width: 24, examples: ["Elevator 1 – A01", "Main water pump", "Living room AC"] }),
      col({ field: "nameAr", header: "Arabic name / الاسم بالعربي", aliases: ["namear", "arabicname", "الاسمبالعربي"], width: 22, examples: ["أسانسير ١ – A01", "طلمبة المياه الرئيسية", "تكييف الريسبشن"] }),
      col({ field: "assetType", header: "Type / النوع", required: true, aliases: ["type", "assettype", "kind", "النوع", "نوعالاصل"], width: 16, examples: ["Elevator", "Water pump", "Split AC"] }),
      CATEGORY(false, ["Elevator", "Plumbing", "HVAC"]),
      col({ ...BUILDING, examples: ["A01", "", "A01"] }),
      col({ ...UNIT(false), examples: ["", "", "A01-101"] }),
      col({ field: "location", header: "Location / المكان", aliases: ["location", "place", "المكان", "الموقع"], width: 22, examples: ["Building A01 core", "Pump room", "Living room"] }),
      col({ field: "installed", header: "Installed on / تاريخ التركيب", aliases: ["installed", "installationdate", "installdate", "تاريخالتركيب"], width: 16, examples: ["2019-06-01", "15/03/2020", "2022-07-10"] }),
      col({ field: "manufacturer", header: "Manufacturer / الشركة المصنعة", aliases: ["manufacturer", "brand", "make", "الشركهالمصنعه", "الماركه"], width: 18, examples: ["Schindler", "Grundfos", "Carrier"] }),
      col({ field: "model", header: "Model / الموديل", aliases: ["model", "الموديل"], width: 14, examples: ["3300", "CR 15", "Optimax"] }),
      col({ field: "serial", header: "Serial no. / الرقم التسلسلي", aliases: ["serial", "serialnumber", "sn", "الرقمالتسلسلي", "السيريال"], width: 18, text: true, examples: ["", "", ""] }),
      col({ field: "warranty", header: "Warranty until / الضمان حتى", aliases: ["warranty", "warrantyexpiry", "warrantyuntil", "الضمان", "انتهاءالضمان"], width: 16, examples: ["2026-06-01", "", "2025-07-10"] }),
      col({ field: "status", header: "Status / الحالة", aliases: ["status", "الحاله"], width: 18, examples: ["operational", "operational", "needs attention"], list: ["operational", "needs attention", "under maintenance", "out of service", "retired"] }),
    ],
    parseRow({ values: v }, err, warn) {
      let ok = true;
      const assetCode = String(v.assetCode ?? "").trim().toUpperCase();
      if (!assetCode) (ok = false), err("assetCode", "Asset code is missing");
      if (!v.name) (ok = false), err("name", "Name is missing");
      if (!v.assetType) (ok = false), err("assetType", "Type is missing (e.g. Elevator, Water pump)");
      const unit = cleanUnitCode(v.unit ?? "");
      const building = cleanUnitCode(v.building ?? "");
      if (!unit && !building) warn("building", "No building or unit — the asset is linked to the compound");
      const installed = readDate(v.installed ?? "", "installed", warn);
      const warranty = readDate(v.warranty ?? "", "warranty", warn);
      let status = parseChoice(v.status ?? "", {
        OPERATIONAL: [...ASSET_STATUS.OPERATIONAL],
        NEEDS_ATTENTION: [...ASSET_STATUS.NEEDS_ATTENTION],
        UNDER_MAINTENANCE: [...ASSET_STATUS.UNDER_MAINTENANCE],
        OUT_OF_SERVICE: [...ASSET_STATUS.OUT_OF_SERVICE],
        RETIRED: [...ASSET_STATUS.RETIRED],
      }, "OPERATIONAL");
      if (status === "invalid") warn("status", "Status not understood — operational used"), (status = "OPERATIONAL");
      if (!ok) return null;
      return {
        assetCode,
        name: v.name,
        nameAr: v.nameAr || null,
        assetType: v.assetType,
        category: v.category || null,
        building: building || null,
        unit: unit || null,
        location: v.location || unit || building || "",
        installed,
        manufacturer: v.manufacturer || null,
        model: v.model || null,
        serial: v.serial || null,
        warranty,
        status,
      };
    },
    fileKey: (v) => String(v.assetCode),
    label: (v) => ({ main: String(v.assetCode), sub: String(v.nameAr || v.name), extra: String(v.unit || v.building || "") }),
  },

  // ───────────────────────── maintenance history ─────────────────────────
  history: {
    type: "history",
    title: { en: "Maintenance history", ar: "سجل الصيانة" },
    description: { en: "Past work per asset from the old system. Added to each asset's history; the same visit is never added twice.", ar: "أعمال الصيانة السابقة لكل أصل من النظام القديم. بتتضاف لسجل كل أصل، ونفس الزيارة مش بتتضاف مرتين." },
    matchBy: { en: "asset + date + description", ar: "الأصل + التاريخ + الوصف" },
    columns: [
      col({ field: "assetCode", header: "Asset code / كود الأصل", required: true, aliases: ["assetcode", "asset", "code", "كودالاصل", "الاصل", "الكود"], width: 18, text: true, examples: ["ELV-A01-1", "ELV-A01-1", "PMP-MAIN-1"] }),
      col({ field: "date", header: "Date / التاريخ", required: true, aliases: ["date", "visitdate", "التاريخ", "تاريخالزياره"], width: 14, examples: ["2025-01-10", "2025-04-12", "15/02/2025"] }),
      col({ field: "kind", header: "Type / النوع", aliases: ["type", "kind", "maintenancetype", "النوع", "نوعالصيانه"], width: 16, examples: ["preventive", "corrective", "inspection"], list: ["preventive", "corrective", "inspection", "emergency"] }),
      col({ field: "description", header: "Work done / الأعمال", required: true, aliases: ["description", "workdone", "work", "details", "notes", "الوصف", "الاعمال", "التفاصيل", "الشغل"], width: 40, examples: ["Monthly service", "Replaced door sensor", "Pressure check"] }),
      col({ field: "cost", header: "Cost EGP / التكلفة", aliases: ["cost", "amount", "price", "التكلفه", "المبلغ", "السعر"], width: 14, examples: ["1500", "3200", ""] }),
      col({ field: "performedBy", header: "Done by / تم بواسطة", aliases: ["performedby", "doneby", "technician", "contractor", "بواسطه", "الفني", "المقاول", "تمبواسطه"], width: 20, examples: ["Lift Masters", "Lift Masters", "Mahmoud Saeed"] }),
    ],
    parseRow({ values: v }, err, warn) {
      let ok = true;
      const assetCode = String(v.assetCode ?? "").trim().toUpperCase();
      if (!assetCode) (ok = false), err("assetCode", "Asset code is missing");
      const date = readDate(v.date ?? "", "date", err);
      if (!v.date) (ok = false), err("date", "Date is missing");
      else if (!date) ok = false;
      if (!v.description) (ok = false), err("description", "Work description is missing");
      let kind = parseChoice(v.kind ?? "", {
        PREVENTIVE: [...MAINTENANCE_TYPES.PREVENTIVE],
        CORRECTIVE: [...MAINTENANCE_TYPES.CORRECTIVE],
        INSPECTION: [...MAINTENANCE_TYPES.INSPECTION],
        EMERGENCY: [...MAINTENANCE_TYPES.EMERGENCY],
      }, "CORRECTIVE");
      if (kind === "invalid") warn("kind", "Type not understood — corrective used"), (kind = "CORRECTIVE");
      let cost = parseNumber(v.cost ?? "");
      if (cost === "invalid" || (typeof cost === "number" && cost < 0)) warn("cost", "Cost not understood — ignored"), (cost = null);
      if (!ok) return null;
      return { assetCode, date, kind, description: String(v.description).replace(/\s+/g, " "), cost, performedBy: v.performedBy || null };
    },
    fileKey: (v) => `${v.assetCode}|${v.date}|${String(v.description).toLowerCase()}`,
    duplicateLevel: "warning",
    label: (v) => ({ main: `${v.assetCode} · ${v.date}`, sub: String(v.description), extra: v.cost ? `${v.cost} EGP` : undefined }),
  },
};

/** Check every row of a file: format problems + duplicates/inconsistencies inside the file. */
export function checkRows(def: ImportDefinition, rows: RawRow[]): { parsed: ParsedRow[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const parsed: ParsedRow[] = [];
  const header = (f: string) => def.columns.find((c) => c.field === f)?.header ?? f;
  const firstByKey = new Map<string, number>();
  const groupValue = new Map<string, { value: string; row: number }>();
  for (const raw of rows) {
    let failed = false;
    const err = (f: string, message: string) => {
      failed = true;
      issues.push({ row: raw.row, column: header(f), value: raw.values[f] ?? "", message, level: "error" });
    };
    const warn = (f: string, message: string) => issues.push({ row: raw.row, column: header(f), value: raw.values[f] ?? "", message, level: "warning" });
    const value = def.parseRow(raw, err, warn);
    if (!value || failed) continue;
    const key = def.fileKey(value);
    const first = firstByKey.get(key);
    if (first !== undefined) {
      const level = def.duplicateLevel ?? "error";
      issues.push({ row: raw.row, message: level === "error" ? `Same ${def.matchBy.en} as row ${first}` : `Same as row ${first} — skipped`, level });
      continue;
    }
    if (def.consistency) {
      const k = def.consistency.key(value);
      const val = def.consistency.value(value);
      const seen = groupValue.get(k);
      if (seen && val && seen.value && seen.value !== val) {
        err(def.consistency.field, def.consistency.message(seen.value, seen.row));
        continue;
      }
      if (!seen && val) groupValue.set(k, { value: val, row: raw.row });
    }
    firstByKey.set(key, raw.row);
    parsed.push({ row: raw.row, value });
  }
  return { parsed, issues };
}

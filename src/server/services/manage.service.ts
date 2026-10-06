import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeAnyPhone, normalizePhoneNumber } from "@/lib/import/core";
import { PRIORITIES } from "@/server/domain/constants";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import { cleanUnitCode, createCodeIndex } from "@/server/domain/unit-codes";
import type { Actor } from "./actor";
import { invalidateCategoryCatalog } from "./category-catalog.service";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { PriorityRulesSchema } from "./settings.service";

/**
 * Create / edit / delete / archive for all master data, with the same rules everywhere:
 *  - records that have history (tickets, quotations…) are ARCHIVED, never deleted;
 *  - everything is validated the same way as the Excel import (phones, unit codes…);
 *  - every change is written to the audit log.
 */

export const ENTITIES = ["residents", "units", "buildings", "technicians", "contractors", "assets", "categories", "teams", "users"] as const;
export type Entity = (typeof ENTITIES)[number];
export const isEntity = (v: unknown): v is Entity => typeof v === "string" && (ENTITIES as readonly string[]).includes(v);

export const STAFF_ROLES = ["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"] as const;

// ───────────────────────── helpers ─────────────────────────

const str = (max = 200) => z.string().trim().max(max);
const optStr = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const phoneField = z.string().trim().min(1, "Mobile number is required").transform((v, ctx) => {
  const p = normalizePhoneNumber(v);
  if (!p) ctx.addIssue({ code: "custom", message: "Not a valid mobile number (Egypt: 01XXXXXXXXX, other countries: +country code)" });
  return p ?? "";
});
const anyPhoneField = z.string().trim().min(1, "Phone number is required").transform((v, ctx) => {
  const p = normalizeAnyPhone(v);
  if (!p) ctx.addIssue({ code: "custom", message: "Not a valid phone number" });
  return p ?? "";
});
const emailField = z.string().trim().toLowerCase().email("Invalid email").max(200);
const dateField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null));

async function audit(actor: Actor, entity: Entity | "sla" | "priorityRules", entityId: string | null, action: string, summary: string, changes?: unknown) {
  await db.auditLog
    .create({ data: { actorId: actor.userId ?? null, actorName: actor.name, entity, entityId, action, summary, changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined } })
    .catch((e) => console.error("[audit] failed", e));
}

/** Only the fields that actually changed — for the audit log. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = v instanceof Date ? v.toISOString() : v;
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

async function defaultCompoundId() {
  const c = await db.compound.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!c) throw new AppError("No compound configured");
  return c.id;
}

async function findUnitByCode(code: string) {
  const units = await db.unit.findMany({ select: { id: true, code: true, buildingId: true } });
  const u = createCodeIndex(units, (x) => x.code).get(code);
  if (!u) throw new AppError(`Unit “${code}” not found`, 400, "VALIDATION_ERROR", { field: "unit" });
  return u;
}

async function findBuildingByCode(code: string, compoundId: string) {
  const buildings = await db.building.findMany({ where: { compoundId }, select: { id: true, code: true } });
  const b = createCodeIndex(buildings, (x) => x.code).get(code);
  if (!b) throw new AppError(`Building “${code}” not found`, 400, "VALIDATION_ERROR", { field: "building" });
  return b;
}

async function categoryIdByKey(key: string | null | undefined) {
  if (!key) return null;
  const c = await db.category.findUnique({ where: { key }, select: { id: true } });
  if (!c) throw new AppError(`Category “${key}” not found`, 400, "VALIDATION_ERROR", { field: "category" });
  return c.id;
}

const tempPassword = () => randomBytes(6).toString("base64url").slice(0, 8);

function blocked(what: string, counts: Record<string, number>, canArchive: boolean): never {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  throw new AppError(
    `${what} can't be deleted — it is linked to ${parts.join(", ")}.${canArchive ? " Archive it instead (it keeps its history)." : ""}`,
    409,
    "IN_USE",
    { canArchive, counts },
  );
}

// ───────────────────────── schemas ─────────────────────────

const ResidentSchema = z.object({
  name: str(120).min(1, "Name is required"),
  nameAr: optStr(120),
  phone: phoneField,
  unit: str(40).min(1, "Unit is required"),
  isOwner: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).default(true),
  language: z.enum(["ar", "en"]).default("ar"),
  email: z.union([emailField, z.literal(""), z.null()]).optional().transform((v) => v || null),
  verified: z.boolean().default(true),
});

const BuildingSchema = z.object({
  code: str(40).min(1, "Code is required"),
  name: optStr(120),
  floors: z.coerce.number().int().min(1).max(200).default(1),
});

const UnitSchema = z.object({
  code: str(40).min(1, "Unit code is required"),
  building: str(40).min(1, "Building is required"),
  floor: z.coerce.number().int().min(-5).max(200).default(0),
  type: str(40).default("Apartment"),
  areaSqm: z.coerce.number().int().min(1).max(100000).optional().nullable(),
});

const TechnicianSchema = z.object({
  name: str(120).min(1, "Name is required"),
  nameAr: optStr(120),
  phone: phoneField,
  email: z.union([emailField, z.literal(""), z.null()]).optional().transform((v) => v || null),
  skills: z.array(z.string().min(1)).min(1, "Choose at least one skill"),
  teamId: optStr(40),
  maxConcurrent: z.coerce.number().int().min(1).max(50).default(5),
  status: z.enum(["AVAILABLE", "BUSY", "OFF_DUTY"]).default("AVAILABLE"),
});

const ContractorSchema = z.object({
  name: str(120).min(1, "Company name is required"),
  nameAr: optStr(120),
  category: str(40).min(1, "Category is required"),
  phone: anyPhoneField,
  email: z.union([emailField, z.literal(""), z.null()]).optional().transform((v) => v || null),
  rating: z.coerce.number().min(0).max(5).default(4),
  isActive: z.boolean().default(true),
});

const AssetSchema = z.object({
  assetCode: str(60).min(1, "Asset code is required").transform((v) => v.toUpperCase()),
  name: str(120).min(1, "Name is required"),
  nameAr: optStr(120),
  type: str(60).min(1, "Type is required"),
  category: optStr(40),
  building: optStr(40),
  unit: optStr(40),
  location: str(120).default(""),
  installationDate: dateField,
  manufacturer: optStr(80),
  model: optStr(80),
  serialNumber: optStr(80),
  warrantyExpiry: dateField,
  status: z.enum(["OPERATIONAL", "NEEDS_ATTENTION", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "RETIRED"]).default("OPERATIONAL"),
});

const CategorySchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,30}$/, "Key: capital letters, digits and _ (e.g. POOL)")
    .optional(),
  nameEn: str(60).min(1, "English name is required"),
  nameAr: str(60).min(1, "Arabic name is required"),
  description: str(300).default(""),
  keywords: z.array(z.string().trim().min(1).max(60)).max(200).default([]),
  defaultPriority: z.enum(PRIORITIES).default("MEDIUM"),
  defaultResolutionMinutes: z.coerce.number().int().min(15).max(60 * 24 * 90).default(48 * 60),
  requiredSkill: str(40).optional(),
  quotationThreshold: z.coerce.number().min(0).max(10_000_000).default(1500),
  priorityRules: PriorityRulesSchema.default([]),
});

const TeamSchema = z.object({
  name: str(80).min(1, "Name is required"),
  nameAr: optStr(80),
  category: optStr(40),
});

const UserSchema = z.object({
  name: str(120).min(1, "Name is required"),
  nameAr: optStr(120),
  email: emailField,
  phone: z.string().trim().optional().nullable().transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhoneNumber(v);
    if (!p) ctx.addIssue({ code: "custom", message: "Not a valid mobile number" });
    return p;
  }),
  role: z.enum(STAFF_ROLES),
  locale: z.enum(["en", "ar"]).default("en"),
});

// ───────────────────────── residents ─────────────────────────

async function residentCreate(input: unknown, actor: Actor) {
  const d = ResidentSchema.parse(input);
  if (await db.resident.findUnique({ where: { phone: d.phone } })) throw new ConflictError("A resident with this mobile number already exists");
  const unit = await findUnitByCode(d.unit);
  const r = await db.resident.create({
    data: { name: d.name, nameAr: d.nameAr ?? d.name, phone: d.phone, unitId: unit.id, isOwner: d.isOwner, language: d.language, email: d.email, verified: d.verified },
  });
  await audit(actor, "residents", r.id, "create", `Added resident ${r.name} (${r.phone}) in ${unit.code}`);
  return r;
}
async function residentUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.resident.findUnique({ where: { id }, include: { unit: { select: { code: true } } } });
  if (!before) throw new NotFoundError("Resident");
  const d = ResidentSchema.parse(input);
  const clash = await db.resident.findUnique({ where: { phone: d.phone } });
  if (clash && clash.id !== id) throw new ConflictError("Another resident already has this mobile number");
  const unit = await findUnitByCode(d.unit);
  const data = { name: d.name, nameAr: d.nameAr ?? d.name, phone: d.phone, unitId: unit.id, isOwner: d.isOwner, language: d.language, email: d.email, verified: d.verified };
  const r = await db.resident.update({ where: { id }, data });
  if (before.phone !== d.phone) await db.conversation.updateMany({ where: { residentId: id }, data: { phone: d.phone } });
  await audit(actor, "residents", id, "update", `Edited resident ${r.name}`, diff({ ...before, unit: before.unit?.code }, { ...data, unit: unit.code }));
  return r;
}
async function residentDelete(id: string, actor: Actor) {
  const r = await db.resident.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!r) throw new NotFoundError("Resident");
  if (r._count.tickets) blocked("This resident", { tickets: r._count.tickets }, true);
  await db.$transaction([
    db.ticketMessage.deleteMany({ where: { conversation: { residentId: id } } }),
    db.conversation.deleteMany({ where: { residentId: id } }),
    db.resident.delete({ where: { id } }),
    ...(r.userId ? [db.user.update({ where: { id: r.userId }, data: { isActive: false } })] : []),
  ]);
  await audit(actor, "residents", id, "delete", `Deleted resident ${r.name} (${r.phone})`);
}
async function residentArchive(id: string, active: boolean, actor: Actor) {
  const r = await db.resident.update({ where: { id }, data: { isActive: active } });
  if (r.userId) await db.user.update({ where: { id: r.userId }, data: { isActive: active } });
  await audit(actor, "residents", id, active ? "restore" : "archive", `${active ? "Restored" : "Archived"} resident ${r.name}`);
  return r;
}

// ───────────────────────── buildings & units ─────────────────────────

async function buildingCreate(input: unknown, actor: Actor) {
  const d = BuildingSchema.parse(input);
  const compoundId = await defaultCompoundId();
  const code = cleanUnitCode(d.code);
  if (await db.building.findUnique({ where: { compoundId_code: { compoundId, code } } })) throw new ConflictError("A building with this code already exists");
  const b = await db.building.create({ data: { compoundId, code, name: d.name ?? code, floors: d.floors } });
  await audit(actor, "buildings", b.id, "create", `Added building ${code}`);
  return b;
}
async function buildingUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.building.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Building");
  const d = BuildingSchema.parse(input);
  const code = cleanUnitCode(d.code);
  const clash = await db.building.findUnique({ where: { compoundId_code: { compoundId: before.compoundId, code } } });
  if (clash && clash.id !== id) throw new ConflictError("Another building already has this code");
  const data = { code, name: d.name ?? code, floors: d.floors };
  const b = await db.building.update({ where: { id }, data });
  await audit(actor, "buildings", id, "update", `Edited building ${code}`, diff(before, data));
  return b;
}
async function buildingDelete(id: string, actor: Actor) {
  const b = await db.building.findUnique({ where: { id }, include: { _count: { select: { units: true, assets: true } } } });
  if (!b) throw new NotFoundError("Building");
  if (b._count.units || b._count.assets) blocked(`Building ${b.code}`, { units: b._count.units, assets: b._count.assets }, false);
  await db.building.delete({ where: { id } });
  await audit(actor, "buildings", id, "delete", `Deleted building ${b.code}`);
}

async function unitCreate(input: unknown, actor: Actor) {
  const d = UnitSchema.parse(input);
  const code = cleanUnitCode(d.code);
  if (await db.unit.findUnique({ where: { code } })) throw new ConflictError("A unit with this code already exists");
  const b = await findBuildingByCode(d.building, await defaultCompoundId());
  const u = await db.unit.create({ data: { code, buildingId: b.id, floor: d.floor, type: d.type || "Apartment", areaSqm: d.areaSqm ?? null } });
  await audit(actor, "units", u.id, "create", `Added unit ${code} in building ${b.code}`);
  return u;
}
async function unitUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.unit.findUnique({ where: { id }, include: { building: true } });
  if (!before) throw new NotFoundError("Unit");
  const d = UnitSchema.parse(input);
  const code = cleanUnitCode(d.code);
  const clash = await db.unit.findUnique({ where: { code } });
  if (clash && clash.id !== id) throw new ConflictError("Another unit already has this code");
  const b = await findBuildingByCode(d.building, before.building.compoundId);
  const data = { code, buildingId: b.id, floor: d.floor, type: d.type || "Apartment", areaSqm: d.areaSqm ?? null };
  const u = await db.unit.update({ where: { id }, data });
  await audit(actor, "units", id, "update", `Edited unit ${code}`, diff({ ...before, buildingId: before.building.code }, { ...data, buildingId: b.code }));
  return u;
}
async function unitDelete(id: string, actor: Actor) {
  const u = await db.unit.findUnique({ where: { id }, include: { _count: { select: { residents: true, tickets: true, assets: true } } } });
  if (!u) throw new NotFoundError("Unit");
  if (u._count.residents || u._count.tickets || u._count.assets) blocked(`Unit ${u.code}`, { residents: u._count.residents, tickets: u._count.tickets, assets: u._count.assets }, false);
  await db.unit.delete({ where: { id } });
  await audit(actor, "units", id, "delete", `Deleted unit ${u.code}`);
}

// ───────────────────────── technicians ─────────────────────────

async function validSkills(skills: string[]) {
  const keys = new Set((await db.category.findMany({ select: { key: true } })).map((c) => c.key));
  const bad = skills.filter((s) => s !== "GENERAL" && !keys.has(s));
  if (bad.length) throw new AppError(`Unknown skill(s): ${bad.join(", ")}`, 400, "VALIDATION_ERROR", { field: "skills" });
  return [...new Set(skills)];
}

async function technicianCreate(input: unknown, actor: Actor) {
  const d = TechnicianSchema.parse(input);
  const skills = await validSkills(d.skills);
  if (await db.technician.findFirst({ where: { phone: d.phone } })) throw new ConflictError("A technician with this mobile number already exists");
  const email = d.email ?? `tech.${d.phone.replace(/\D/g, "").slice(-10)}@maintenanceos.local`;
  if (await db.user.findUnique({ where: { email } })) throw new ConflictError("This login email is already used");
  const password = tempPassword();
  const compoundId = await defaultCompoundId();
  const t = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: d.name, nameAr: d.nameAr, phone: d.phone, role: "TECHNICIAN", passwordHash: await bcrypt.hash(password, 10), compoundId } });
    return tx.technician.create({
      data: { userId: user.id, name: d.name, nameAr: d.nameAr, phone: d.phone, skills, teamId: d.teamId, maxConcurrent: d.maxConcurrent, status: d.status },
    });
  });
  await audit(actor, "technicians", t.id, "create", `Added technician ${t.name} (${t.phone})`);
  return { ...t, credentials: { email, password } };
}
async function technicianUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.technician.findUnique({ where: { id }, include: { user: true } });
  if (!before) throw new NotFoundError("Technician");
  const d = TechnicianSchema.parse(input);
  const skills = await validSkills(d.skills);
  const clash = await db.technician.findFirst({ where: { phone: d.phone, id: { not: id } } });
  if (clash) throw new ConflictError("Another technician already has this mobile number");
  if (d.email && d.email !== before.user.email) {
    if (await db.user.findUnique({ where: { email: d.email } })) throw new ConflictError("This login email is already used");
  }
  const data = { name: d.name, nameAr: d.nameAr, phone: d.phone, skills, teamId: d.teamId, maxConcurrent: d.maxConcurrent, status: d.status };
  const t = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: before.userId }, data: { name: d.name, nameAr: d.nameAr, phone: d.phone, ...(d.email ? { email: d.email } : {}) } });
    return tx.technician.update({ where: { id }, data });
  });
  await audit(actor, "technicians", id, "update", `Edited technician ${t.name}`, diff(before, data));
  return t;
}
async function technicianDelete(id: string, actor: Actor) {
  const t = await db.technician.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!t) throw new NotFoundError("Technician");
  if (t._count.tickets) blocked("This technician", { tickets: t._count.tickets }, true);
  await db.$transaction([db.technician.delete({ where: { id } }), db.notification.deleteMany({ where: { userId: t.userId } }), db.user.delete({ where: { id: t.userId } })]);
  await audit(actor, "technicians", id, "delete", `Deleted technician ${t.name}`);
}
async function technicianArchive(id: string, active: boolean, actor: Actor) {
  const t = await db.technician.update({ where: { id }, data: { isActive: active, ...(active ? {} : { status: "OFF_DUTY" }) } });
  await db.user.update({ where: { id: t.userId }, data: { isActive: active } });
  await audit(actor, "technicians", id, active ? "restore" : "archive", `${active ? "Restored" : "Archived"} technician ${t.name}`);
  return t;
}
async function resetUserPassword(userId: string, label: string, entity: Entity, entityId: string, actor: Actor) {
  const password = tempPassword();
  const u = await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  await audit(actor, entity, entityId, "reset_password", `Reset the password of ${label}`);
  return { email: u.email, password };
}

// ───────────────────────── contractors ─────────────────────────

async function contractorData(d: z.infer<typeof ContractorSchema>) {
  return { name: d.name, nameAr: d.nameAr, categoryId: await categoryIdByKey(d.category), phone: d.phone, email: d.email, rating: d.rating, isActive: d.isActive };
}
async function contractorCreate(input: unknown, actor: Actor) {
  const d = ContractorSchema.parse(input);
  const c = await db.contractor.create({ data: await contractorData(d) });
  await audit(actor, "contractors", c.id, "create", `Added contractor ${c.name}`);
  return c;
}
async function contractorUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.contractor.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Contractor");
  const data = await contractorData(ContractorSchema.parse(input));
  const c = await db.contractor.update({ where: { id }, data });
  await audit(actor, "contractors", id, "update", `Edited contractor ${c.name}`, diff(before, data));
  return c;
}
async function contractorDelete(id: string, actor: Actor) {
  const c = await db.contractor.findUnique({ where: { id }, include: { _count: { select: { tickets: true, quotations: true, users: true } } } });
  if (!c) throw new NotFoundError("Contractor");
  if (c._count.tickets || c._count.quotations || c._count.users) blocked("This contractor", { tickets: c._count.tickets, quotations: c._count.quotations, "login accounts": c._count.users }, true);
  await db.ticket.updateMany({ where: { suggestedContractorId: id }, data: { suggestedContractorId: null } });
  await db.contractor.delete({ where: { id } });
  await audit(actor, "contractors", id, "delete", `Deleted contractor ${c.name}`);
}
async function contractorArchive(id: string, active: boolean, actor: Actor) {
  const c = await db.contractor.update({ where: { id }, data: { isActive: active } });
  await db.user.updateMany({ where: { contractorId: id }, data: { isActive: active } });
  await audit(actor, "contractors", id, active ? "restore" : "archive", `${active ? "Restored" : "Archived"} contractor ${c.name}`);
  return c;
}

// ───────────────────────── assets ─────────────────────────

async function assetData(d: z.infer<typeof AssetSchema>, compoundId: string) {
  let unitId: string | null = null;
  let buildingId: string | null = null;
  if (d.unit) {
    const u = await findUnitByCode(d.unit);
    unitId = u.id;
    buildingId = u.buildingId;
  } else if (d.building) buildingId = (await findBuildingByCode(d.building, compoundId)).id;
  return {
    name: d.name,
    nameAr: d.nameAr,
    type: d.type,
    categoryId: await categoryIdByKey(d.category),
    unitId,
    buildingId,
    location: d.location || d.unit || d.building || "",
    installationDate: d.installationDate,
    manufacturer: d.manufacturer,
    model: d.model,
    serialNumber: d.serialNumber,
    warrantyExpiry: d.warrantyExpiry,
    status: d.status,
  };
}
async function assetCreate(input: unknown, actor: Actor) {
  const d = AssetSchema.parse(input);
  if (await db.asset.findUnique({ where: { assetCode: d.assetCode } })) throw new ConflictError("An asset with this code already exists");
  const compoundId = await defaultCompoundId();
  const a = await db.asset.create({ data: { assetCode: d.assetCode, compoundId, ...(await assetData(d, compoundId)) } });
  await audit(actor, "assets", a.id, "create", `Added asset ${a.assetCode}`);
  return a;
}
async function assetUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.asset.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Asset");
  const d = AssetSchema.parse(input);
  const clash = await db.asset.findUnique({ where: { assetCode: d.assetCode } });
  if (clash && clash.id !== id) throw new ConflictError("Another asset already has this code");
  const data = { assetCode: d.assetCode, ...(await assetData(d, before.compoundId)) };
  const a = await db.asset.update({ where: { id }, data });
  await audit(actor, "assets", id, "update", `Edited asset ${a.assetCode}`, diff(before, data));
  return a;
}
async function assetDelete(id: string, actor: Actor) {
  const a = await db.asset.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!a) throw new NotFoundError("Asset");
  if (a._count.tickets) blocked(`Asset ${a.assetCode}`, { tickets: a._count.tickets }, true);
  await db.asset.delete({ where: { id } });
  await audit(actor, "assets", id, "delete", `Deleted asset ${a.assetCode}`);
}
async function assetArchive(id: string, active: boolean, actor: Actor) {
  const a = await db.asset.update({ where: { id }, data: { status: active ? "OPERATIONAL" : "RETIRED" } });
  await audit(actor, "assets", id, active ? "restore" : "archive", `${active ? "Restored" : "Retired"} asset ${a.assetCode}`);
  return a;
}

// ───────────────────────── categories ─────────────────────────

function keyFromName(name: string) {
  const k = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return /^[A-Z]/.test(k) ? k : `CAT_${k || Date.now().toString(36).toUpperCase()}`;
}
async function categoryCreate(input: unknown, actor: Actor) {
  const d = CategorySchema.parse(input);
  const key = d.key ?? keyFromName(d.nameEn);
  if (await db.category.findUnique({ where: { key } })) throw new ConflictError(`A category with key ${key} already exists`);
  const max = await db.category.aggregate({ _max: { sortOrder: true } });
  const c = await db.category.create({
    data: {
      key,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      description: d.description,
      keywords: d.keywords,
      defaultPriority: d.defaultPriority,
      defaultResolutionMinutes: d.defaultResolutionMinutes,
      requiredSkill: d.requiredSkill || key,
      quotationThreshold: d.quotationThreshold,
      priorityRules: d.priorityRules as unknown as Prisma.InputJsonValue,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  invalidateCategoryCatalog();
  await audit(actor, "categories", c.id, "create", `Added category ${c.nameEn} (${key})`);
  return c;
}
async function categoryUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.category.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Category");
  const d = CategorySchema.parse(input);
  const data = {
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    description: d.description,
    keywords: d.keywords,
    defaultPriority: d.defaultPriority,
    defaultResolutionMinutes: d.defaultResolutionMinutes,
    requiredSkill: d.requiredSkill || before.requiredSkill,
    quotationThreshold: d.quotationThreshold,
    priorityRules: d.priorityRules as unknown as Prisma.InputJsonValue,
  };
  const c = await db.category.update({ where: { id }, data });
  invalidateCategoryCatalog();
  await audit(actor, "categories", id, "update", `Edited category ${c.nameEn}`, diff({ ...before, quotationThreshold: Number(before.quotationThreshold) }, data));
  return c;
}
async function categoryDelete(id: string, actor: Actor) {
  const c = await db.category.findUnique({ where: { id }, include: { _count: { select: { tickets: true, assets: true, contractors: true, teams: true } } } });
  if (!c) throw new NotFoundError("Category");
  if (c.key === "OTHER") throw new AppError("The “Other” category is required by the system", 400);
  const techs = await db.technician.count({ where: { skills: { has: c.key } } });
  if (CATEGORY_BY_KEY[c.key as keyof typeof CATEGORY_BY_KEY]) {
    throw new AppError(`${c.nameEn} is a built-in category and can't be deleted — archive it instead to hide it.`, 409, "IN_USE", { canArchive: true });
  }
  if (c._count.tickets || c._count.assets || c._count.contractors || c._count.teams || techs)
    blocked(`Category ${c.nameEn}`, { tickets: c._count.tickets, assets: c._count.assets, contractors: c._count.contractors, teams: c._count.teams, technicians: techs }, true);
  await db.category.delete({ where: { id } });
  invalidateCategoryCatalog();
  await audit(actor, "categories", id, "delete", `Deleted category ${c.nameEn}`);
}
async function categoryArchive(id: string, active: boolean, actor: Actor) {
  const c = await db.category.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Category");
  if (c.key === "OTHER" && !active) throw new AppError("The “Other” category is required by the system", 400);
  const u = await db.category.update({ where: { id }, data: { isActive: active } });
  invalidateCategoryCatalog();
  await audit(actor, "categories", id, active ? "restore" : "archive", `${active ? "Restored" : "Archived"} category ${c.nameEn}`);
  return u;
}

// ───────────────────────── teams ─────────────────────────

async function teamCreate(input: unknown, actor: Actor) {
  const d = TeamSchema.parse(input);
  const t = await db.team.create({ data: { name: d.name, nameAr: d.nameAr, categoryId: await categoryIdByKey(d.category), compoundId: await defaultCompoundId() } });
  await audit(actor, "teams", t.id, "create", `Added team ${t.name}`);
  return t;
}
async function teamUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.team.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Team");
  const d = TeamSchema.parse(input);
  const data = { name: d.name, nameAr: d.nameAr, categoryId: await categoryIdByKey(d.category) };
  const t = await db.team.update({ where: { id }, data });
  await audit(actor, "teams", id, "update", `Edited team ${t.name}`, diff(before, data));
  return t;
}
async function teamDelete(id: string, actor: Actor) {
  const t = await db.team.findUnique({ where: { id } });
  if (!t) throw new NotFoundError("Team");
  // Members and past tickets simply lose the team label
  await db.$transaction([
    db.technician.updateMany({ where: { teamId: id }, data: { teamId: null } }),
    db.ticket.updateMany({ where: { teamId: id }, data: { teamId: null } }),
    db.team.delete({ where: { id } }),
  ]);
  await audit(actor, "teams", id, "delete", `Deleted team ${t.name}`);
}

// ───────────────────────── staff users ─────────────────────────

function assertCanManageRole(actorRole: Role | null | undefined, role: Role) {
  if (role === "ADMIN" && actorRole !== "ADMIN") throw new ForbiddenError("Only an admin can manage admin accounts");
}
async function lastActiveAdmin(id: string) {
  const admins = await db.user.count({ where: { role: "ADMIN", isActive: true, id: { not: id } } });
  return admins === 0;
}
async function userCreate(input: unknown, actor: Actor) {
  const d = UserSchema.parse(input);
  assertCanManageRole(actor.role, d.role);
  if (await db.user.findUnique({ where: { email: d.email } })) throw new ConflictError("This email is already used");
  const password = tempPassword();
  const u = await db.user.create({
    data: { name: d.name, nameAr: d.nameAr, email: d.email, phone: d.phone, role: d.role, locale: d.locale, passwordHash: await bcrypt.hash(password, 10), compoundId: await defaultCompoundId() },
  });
  await audit(actor, "users", u.id, "create", `Added ${d.role.toLowerCase().replace("_", " ")} ${u.name} (${u.email})`);
  return { id: u.id, credentials: { email: u.email, password } };
}
async function userUpdate(id: string, input: unknown, actor: Actor) {
  const before = await db.user.findUnique({ where: { id } });
  if (!before || !(STAFF_ROLES as readonly string[]).includes(before.role)) throw new NotFoundError("User");
  const d = UserSchema.parse(input);
  assertCanManageRole(actor.role, before.role);
  assertCanManageRole(actor.role, d.role);
  if (before.role === "ADMIN" && d.role !== "ADMIN" && (await lastActiveAdmin(id))) throw new AppError("This is the last active admin — make someone else admin first", 400);
  const clash = await db.user.findUnique({ where: { email: d.email } });
  if (clash && clash.id !== id) throw new ConflictError("This email is already used");
  const data = { name: d.name, nameAr: d.nameAr, email: d.email, phone: d.phone, role: d.role, locale: d.locale };
  const u = await db.user.update({ where: { id }, data });
  await audit(actor, "users", id, "update", `Edited user ${u.name}`, diff(before, data));
  return { id: u.id };
}
async function userArchive(id: string, active: boolean, actor: Actor) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u || !(STAFF_ROLES as readonly string[]).includes(u.role)) throw new NotFoundError("User");
  assertCanManageRole(actor.role, u.role);
  if (!active && id === actor.userId) throw new AppError("You can't deactivate your own account", 400);
  if (!active && u.role === "ADMIN" && (await lastActiveAdmin(id))) throw new AppError("This is the last active admin", 400);
  await db.user.update({ where: { id }, data: { isActive: active } });
  await audit(actor, "users", id, active ? "restore" : "archive", `${active ? "Activated" : "Deactivated"} user ${u.name}`);
  return { id };
}

// ───────────────────────── dispatch ─────────────────────────

type Ops = {
  create: (input: unknown, actor: Actor) => Promise<unknown>;
  update: (id: string, input: unknown, actor: Actor) => Promise<unknown>;
  remove?: (id: string, actor: Actor) => Promise<void>;
  archive?: (id: string, active: boolean, actor: Actor) => Promise<unknown>;
};

const OPS: Record<Entity, Ops> = {
  residents: { create: residentCreate, update: residentUpdate, remove: residentDelete, archive: residentArchive },
  buildings: { create: buildingCreate, update: buildingUpdate, remove: buildingDelete },
  units: { create: unitCreate, update: unitUpdate, remove: unitDelete },
  technicians: { create: technicianCreate, update: technicianUpdate, remove: technicianDelete, archive: technicianArchive },
  contractors: { create: contractorCreate, update: contractorUpdate, remove: contractorDelete, archive: contractorArchive },
  assets: { create: assetCreate, update: assetUpdate, remove: assetDelete, archive: assetArchive },
  categories: { create: categoryCreate, update: categoryUpdate, remove: categoryDelete, archive: categoryArchive },
  teams: { create: teamCreate, update: teamUpdate, remove: teamDelete },
  users: { create: userCreate, update: userUpdate, archive: userArchive },
};

export const createRecord = (entity: Entity, input: unknown, actor: Actor) => OPS[entity].create(input, actor);
export const updateRecord = (entity: Entity, id: string, input: unknown, actor: Actor) => OPS[entity].update(id, input, actor);

export async function deleteRecord(entity: Entity, id: string, actor: Actor) {
  const op = OPS[entity].remove;
  if (!op) throw new AppError("These records can't be deleted — deactivate them instead", 400);
  await op(id, actor);
}

export async function setActive(entity: Entity, id: string, active: boolean, actor: Actor) {
  const op = OPS[entity].archive;
  if (!op) throw new AppError("These records can't be archived", 400);
  return op(id, active, actor);
}

export async function resetPassword(entity: Entity, id: string, actor: Actor) {
  if (entity === "technicians") {
    const t = await db.technician.findUnique({ where: { id } });
    if (!t) throw new NotFoundError("Technician");
    return resetUserPassword(t.userId, t.name, entity, id, actor);
  }
  if (entity === "users") {
    const u = await db.user.findUnique({ where: { id } });
    if (!u || !(STAFF_ROLES as readonly string[]).includes(u.role)) throw new NotFoundError("User");
    assertCanManageRole(actor.role, u.role);
    return resetUserPassword(u.id, u.name, entity, id, actor);
  }
  throw new AppError("Passwords exist only for technicians and staff users", 400);
}

export { audit as recordAudit };

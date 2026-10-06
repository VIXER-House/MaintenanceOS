import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { AssetStatus, MaintenanceType, Prisma, TechnicianStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { findKeywords } from "@/lib/arabic";
import { normHeader, type ImportIssue, type ImportType } from "@/lib/import/core";
import type { ParsedRow } from "@/lib/import/definitions";
import { CATEGORY_CATALOG } from "@/server/domain/categories";
import { createCodeIndex, normalizeUnitCode } from "@/server/domain/unit-codes";

export type Action = "new" | "update" | "unchanged";
export interface Item {
  row: number;
  action: Action;
  value: Record<string, unknown>;
  existingId?: string;
  /** Resolved references (ids) for apply */
  ref?: Record<string, string | string[] | null>;
}
export interface AnalyzeResult {
  items: Item[];
  issues: ImportIssue[];
  newUnits: string[];
  newBuildings: string[];
  newTeams: string[];
}
export interface ApplyResult {
  created: number;
  updated: number;
  unchanged: number;
  credentials?: { name: string; phone: string; email: string; password: string }[];
}
export interface Ctx {
  compoundId: string;
}
interface Handler {
  analyze(rows: ParsedRow[], ctx: Ctx): Promise<AnalyzeResult>;
  apply(items: Item[], ctx: Ctx): Promise<ApplyResult>;
}

const empty = (): AnalyzeResult => ({ items: [], issues: [], newUnits: [], newBuildings: [], newTeams: [] });
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const same = (a: unknown, b: unknown) => s(a) === s(b);
const dayStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const toDate = (v: unknown) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

// ───────────────────────── shared lookups ─────────────────────────

async function loadCategories() {
  const cats = await db.category.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true } });
  const exact = new Map<string, { id: string; key: string }>();
  for (const c of cats) for (const n of [c.key, c.nameEn, c.nameAr]) exact.set(normHeader(n), { id: c.id, key: c.key });
  // a few common words not in the names
  const extra: Record<string, string> = { elevators: "ELEVATOR", lift: "ELEVATOR", lifts: "ELEVATOR", اسانسير: "ELEVATOR", اسانسيرات: "ELEVATOR", مصعد: "ELEVATOR", ac: "HVAC", aircondition: "HVAC", تكييف: "HVAC", تكييفات: "HVAC", electric: "ELECTRICAL", electrician: "ELECTRICAL", plumber: "PLUMBING", سباك: "PLUMBING", كهربائي: "ELECTRICAL", نقاش: "PAINTING", نجار: "CARPENTRY", civil: "CIVIL", مدني: "CIVIL", مدنيه: "CIVIL", garden: "LANDSCAPING", gardening: "LANDSCAPING", زراعه: "LANDSCAPING", حدائق: "LANDSCAPING", security: "SECURITY", امن: "SECURITY", cleaning: "CLEANING", نظافه: "CLEANING" };
  for (const [w, key] of Object.entries(extra)) {
    const c = cats.find((x) => x.key === key);
    if (c && !exact.has(normHeader(w))) exact.set(normHeader(w), { id: c.id, key: c.key });
  }
  return (name: string): { id: string; key: string } | null => {
    const hit = exact.get(normHeader(name));
    if (hit) return hit;
    // Fall back to the AI vocabulary ("سباكة وصرف" → PLUMBING)
    for (const def of CATEGORY_CATALOG) {
      if (def.key === "OTHER") continue;
      if (findKeywords(name, def.keywords).length) {
        const c = cats.find((x) => x.key === def.key);
        if (c) return { id: c.id, key: c.key };
      }
    }
    return null;
  };
}

async function loadUnits(compoundId: string) {
  const [buildings, units] = await Promise.all([
    db.building.findMany({ where: { compoundId }, select: { id: true, code: true } }),
    db.unit.findMany({ select: { id: true, code: true, floor: true, type: true, areaSqm: true, buildingId: true, building: { select: { code: true, compoundId: true } } } }),
  ]);
  return {
    buildings,
    buildingByCode: createCodeIndex(buildings, (b) => b.code),
    unitByCode: createCodeIndex(units, (u) => u.code),
  };
}

/** Units/buildings referenced by residents or unit rows: existing → resolved, missing → planned. */
function planUnits(items: { row: number; unit: string; building: string }[], lookup: Awaited<ReturnType<typeof loadUnits>>, compoundId: string, issues: ImportIssue[], buildingHeader: string, unitHeader: string) {
  const newUnits = new Set<string>();
  const newBuildings = new Set<string>();
  const failed = new Set<number>();
  const resolved = new Map<number, { unit: string; building: string; unitIsNew: boolean }>();
  for (const it of items) {
    const existing = lookup.unitByCode.get(it.unit);
    if (existing) {
      if (existing.building.compoundId !== compoundId) {
        issues.push({ row: it.row, column: unitHeader, value: it.unit, message: "This unit code already belongs to another compound", level: "error" });
        failed.add(it.row);
        continue;
      }
      if (it.building && normalizeUnitCode(it.building) !== normalizeUnitCode(existing.building.code)) {
        issues.push({ row: it.row, column: buildingHeader, value: it.building, message: `Unit ${existing.code} is already in building ${existing.building.code} — kept there`, level: "warning" });
      }
      resolved.set(it.row, { unit: existing.code, building: existing.building.code, unitIsNew: false });
      continue;
    }
    if (!it.building) {
      issues.push({ row: it.row, column: buildingHeader, value: "", message: `New unit ${it.unit}: building is missing`, level: "error" });
      failed.add(it.row);
      continue;
    }
    const b = lookup.buildingByCode.get(it.building);
    const building = b?.code ?? it.building;
    if (!b) newBuildings.add(building);
    newUnits.add(it.unit);
    resolved.set(it.row, { unit: it.unit, building, unitIsNew: true });
  }
  return { newUnits, newBuildings, failed, resolved };
}

/** Create missing buildings and units; returns unit code → id. */
async function ensureUnits(compoundId: string, rows: { unit: string; building: string; floor?: number; unitType?: string; area?: number | null }[]) {
  const buildings = [...new Set(rows.map((r) => r.building))];
  if (buildings.length) {
    const floors = new Map<string, number>();
    for (const r of rows) floors.set(r.building, Math.max(floors.get(r.building) ?? 1, (r.floor ?? 0) + 1));
    await db.building.createMany({ data: buildings.map((code) => ({ compoundId, code, name: code, floors: floors.get(code) ?? 1 })), skipDuplicates: true });
  }
  const bIds = new Map((await db.building.findMany({ where: { compoundId, code: { in: buildings } }, select: { id: true, code: true } })).map((b) => [b.code, b.id]));
  const unique = new Map(rows.map((r) => [r.unit, r]));
  await db.unit.createMany({
    data: [...unique.values()].map((r) => ({ code: r.unit, buildingId: bIds.get(r.building)!, floor: r.floor ?? 0, type: r.unitType || "Apartment", areaSqm: r.area ?? null })),
    skipDuplicates: true,
  });
}

// ───────────────────────── residents ─────────────────────────

const residents: Handler = {
  async analyze(rows, ctx) {
    const out = empty();
    const lookup = await loadUnits(ctx.compoundId);
    const plan = planUnits(rows.map((r) => ({ row: r.row, unit: s(r.value.unit), building: s(r.value.building) })), lookup, ctx.compoundId, out.issues, "Building / المبنى", "Unit code / رقم الوحدة");
    const ok = rows.filter((r) => !plan.failed.has(r.row));
    const existing = await db.resident.findMany({
      where: { phone: { in: ok.map((r) => s(r.value.phone)) } },
      select: { id: true, phone: true, name: true, nameAr: true, unit: { select: { code: true } }, isOwner: true, language: true, email: true, verified: true },
    });
    const byPhone = new Map(existing.map((e) => [e.phone, e]));
    for (const r of ok) {
      const u = plan.resolved.get(r.row)!;
      const value: Record<string, unknown> = { ...r.value, unit: u.unit, building: u.building, unitIsNew: u.unitIsNew };
      const e = byPhone.get(s(value.phone));
      if (!e) {
        out.items.push({ row: r.row, action: "new", value });
        continue;
      }
      const unchanged =
        same(e.name, value.name) && same(e.nameAr, value.nameAr) && same(e.unit?.code, value.unit) && e.isOwner === value.isOwner && same(e.language, value.language) && (!value.email || same(e.email, value.email)) && e.verified;
      out.items.push({ row: r.row, action: unchanged ? "unchanged" : "update", value, existingId: e.id });
    }
    out.newUnits = [...plan.newUnits];
    out.newBuildings = [...plan.newBuildings];
    return out;
  },
  async apply(items, ctx) {
    const unitRows = items.filter((i) => i.value.unitIsNew).map((i) => ({ unit: s(i.value.unit), building: s(i.value.building), floor: Number(i.value.floor ?? 0), unitType: s(i.value.unitType) }));
    if (unitRows.length) await ensureUnits(ctx.compoundId, unitRows);
    const unitId = new Map((await db.unit.findMany({ where: { code: { in: [...new Set(items.map((i) => s(i.value.unit)))] } }, select: { id: true, code: true } })).map((u) => [u.code, u.id]));
    const fresh = items.filter((i) => i.action === "new");
    if (fresh.length) {
      await db.resident.createMany({
        data: fresh.map(({ value: v }) => ({ phone: s(v.phone), name: s(v.name), nameAr: s(v.nameAr), unitId: unitId.get(s(v.unit))!, isOwner: Boolean(v.isOwner), language: s(v.language), email: (v.email as string) || null, verified: true })),
        skipDuplicates: true,
      });
    }
    const changed = items.filter((i) => i.action === "update");
    for (let k = 0; k < changed.length; k += 100) {
      await db.$transaction(
        changed.slice(k, k + 100).map(({ value: v, existingId }) =>
          db.resident.update({
            where: { id: existingId },
            data: { name: s(v.name), nameAr: s(v.nameAr), unitId: unitId.get(s(v.unit))!, isOwner: Boolean(v.isOwner), language: s(v.language), ...(v.email ? { email: s(v.email) } : {}), verified: true },
          }),
        ),
      );
    }
    return { created: fresh.length, updated: changed.length, unchanged: items.filter((i) => i.action === "unchanged").length };
  },
};

// ───────────────────────── units ─────────────────────────

const units: Handler = {
  async analyze(rows, ctx) {
    const out = empty();
    const lookup = await loadUnits(ctx.compoundId);
    const plan = planUnits(rows.map((r) => ({ row: r.row, unit: s(r.value.unit), building: s(r.value.building) })), lookup, ctx.compoundId, out.issues, "Building / المبنى", "Unit code / رقم الوحدة");
    for (const r of rows) {
      if (plan.failed.has(r.row)) continue;
      const u = plan.resolved.get(r.row)!;
      const value: Record<string, unknown> = { ...r.value, unit: u.unit, building: u.building };
      if (u.unitIsNew) {
        out.items.push({ row: r.row, action: "new", value });
        continue;
      }
      const e = lookup.unitByCode.get(u.unit)!;
      const unchanged = (value.floor === null || e.floor === value.floor) && (!value.unitType || e.type === value.unitType) && (!value.area || e.areaSqm === value.area);
      out.items.push({ row: r.row, action: unchanged ? "unchanged" : "update", value, existingId: e.id });
    }
    out.newUnits = [...plan.newUnits];
    out.newBuildings = [...plan.newBuildings];
    return out;
  },
  async apply(items, ctx) {
    const fresh = items.filter((i) => i.action === "new");
    if (fresh.length) {
      await ensureUnits(
        ctx.compoundId,
        fresh.map(({ value: v }) => ({ unit: s(v.unit), building: s(v.building), floor: Number(v.floor ?? 0), unitType: s(v.unitType), area: (v.area as number | null) ?? null })),
      );
    }
    const changed = items.filter((i) => i.action === "update");
    for (let k = 0; k < changed.length; k += 100) {
      await db.$transaction(
        changed.slice(k, k + 100).map(({ value: v, existingId }) =>
          db.unit.update({ where: { id: existingId }, data: { ...(v.floor !== null && v.floor !== undefined ? { floor: Number(v.floor) } : {}), ...(v.unitType ? { type: s(v.unitType) } : {}), ...(v.area ? { areaSqm: Number(v.area) } : {}) } }),
        ),
      );
    }
    return { created: fresh.length, updated: changed.length, unchanged: items.filter((i) => i.action === "unchanged").length };
  },
};

// ───────────────────────── technicians ─────────────────────────

const GENERAL_WORDS = new Set(["general", "handyman", "all", "عام", "عامه", "كلشيء", "متعدد"].map(normHeader));

const technicians: Handler = {
  async analyze(rows, ctx) {
    const out = empty();
    const findCategory = await loadCategories();
    const teams = await db.team.findMany({ where: { compoundId: ctx.compoundId }, select: { id: true, name: true, nameAr: true } });
    const teamByName = new Map(teams.flatMap((t) => [[normHeader(t.name), t], ...(t.nameAr ? [[normHeader(t.nameAr), t] as const] : [])]));
    const newTeams = new Set<string>();
    const existing = await db.technician.findMany({ select: { id: true, phone: true, name: true, nameAr: true, skills: true, teamId: true, maxConcurrent: true, status: true, user: { select: { email: true } } } });
    const byPhone = new Map(existing.map((t) => [t.phone, t]));
    const emails = new Set((await db.user.findMany({ where: { email: { in: rows.map((r) => s(r.value.email)).filter(Boolean) } }, select: { email: true } })).map((u) => u.email));

    for (const r of rows) {
      const skills: string[] = [];
      let bad = false;
      for (const sk of r.value.skills as string[]) {
        if (GENERAL_WORDS.has(normHeader(sk))) skills.push("GENERAL");
        else {
          const c = findCategory(sk);
          if (c) skills.push(c.key);
          else {
            out.issues.push({ row: r.row, column: "Skills / المهارات", value: sk, message: `Unknown skill “${sk}” — use a category name (Plumbing, Electrical, HVAC, سباكة…) or “General”`, level: "error" });
            bad = true;
          }
        }
      }
      if (bad) continue;
      const teamName = s(r.value.team);
      const team = teamName ? teamByName.get(normHeader(teamName)) : undefined;
      if (teamName && !team) newTeams.add(teamName);
      const e = byPhone.get(s(r.value.phone));
      if (!e && r.value.email && emails.has(s(r.value.email))) {
        out.issues.push({ row: r.row, column: "Login email / بريد الدخول", value: s(r.value.email), message: "This email is already used by another login", level: "error" });
        continue;
      }
      const value: Record<string, unknown> = { ...r.value, skills: [...new Set(skills)] };
      if (!e) {
        out.items.push({ row: r.row, action: "new", value, ref: { teamId: team?.id ?? null } });
        continue;
      }
      const unchanged =
        same(e.name, value.name) && same(e.nameAr, value.nameAr) && [...e.skills].sort().join() === [...(value.skills as string[])].sort().join() && (!teamName || e.teamId === team?.id) && e.maxConcurrent === value.maxJobs && e.status === value.status;
      out.items.push({ row: r.row, action: unchanged ? "unchanged" : "update", value, existingId: e.id, ref: { teamId: team?.id ?? null } });
    }
    out.newTeams = [...newTeams];
    return out;
  },
  async apply(items, ctx) {
    // Teams that don't exist yet
    const teamNames = [...new Set(items.map((i) => s(i.value.team)).filter(Boolean))];
    const findCategory = await loadCategories();
    const teams = await db.team.findMany({ where: { compoundId: ctx.compoundId }, select: { id: true, name: true, nameAr: true } });
    const teamId = new Map<string, string>();
    for (const t of teams) {
      teamId.set(normHeader(t.name), t.id);
      if (t.nameAr) teamId.set(normHeader(t.nameAr), t.id);
    }
    for (const name of teamNames) {
      if (teamId.has(normHeader(name))) continue;
      const firstSkill = (items.find((i) => s(i.value.team) === name)?.value.skills as string[] | undefined)?.find((k) => k !== "GENERAL");
      const cat = firstSkill ? findCategory(firstSkill) : null;
      const t = await db.team.create({ data: { name, compoundId: ctx.compoundId, categoryId: cat?.id ?? null } });
      teamId.set(normHeader(name), t.id);
    }
    const credentials: NonNullable<ApplyResult["credentials"]> = [];
    let created = 0;
    for (const { value: v } of items.filter((i) => i.action === "new")) {
      const digits = s(v.phone).replace(/\D/g, "");
      const email = s(v.email) || `tech.${digits.slice(-10)}@maintenanceos.local`;
      const password = randomBytes(6).toString("base64url").slice(0, 8);
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, name: s(v.name), nameAr: s(v.nameAr), passwordHash: await bcrypt.hash(password, 10), role: "TECHNICIAN", phone: s(v.phone), compoundId: ctx.compoundId },
        });
        await tx.technician.create({
          data: {
            userId: user.id,
            name: s(v.name),
            nameAr: s(v.nameAr),
            phone: s(v.phone),
            skills: v.skills as string[],
            teamId: v.team ? teamId.get(normHeader(s(v.team))) ?? null : null,
            maxConcurrent: Number(v.maxJobs ?? 5),
            status: v.status as TechnicianStatus,
          },
        });
      });
      credentials.push({ name: s(v.name), phone: s(v.phone), email, password });
      created++;
    }
    const changed = items.filter((i) => i.action === "update");
    for (const { value: v, existingId } of changed) {
      await db.technician.update({
        where: { id: existingId },
        data: {
          name: s(v.name),
          nameAr: s(v.nameAr),
          skills: v.skills as string[],
          ...(v.team ? { teamId: teamId.get(normHeader(s(v.team))) ?? null } : {}),
          maxConcurrent: Number(v.maxJobs ?? 5),
          status: v.status as TechnicianStatus,
        },
      });
    }
    return { created, updated: changed.length, unchanged: items.filter((i) => i.action === "unchanged").length, credentials };
  },
};

// ───────────────────────── contractors ─────────────────────────

const contractors: Handler = {
  async analyze(rows) {
    const out = empty();
    const findCategory = await loadCategories();
    const existing = await db.contractor.findMany({ select: { id: true, phone: true, name: true, nameAr: true, categoryId: true, email: true, isActive: true } });
    const byPhone = new Map(existing.map((c) => [c.phone, c]));
    for (const r of rows) {
      const cat = findCategory(s(r.value.category));
      if (!cat) {
        out.issues.push({ row: r.row, column: "Category / التصنيف", value: s(r.value.category), message: "Unknown category — use one of the categories in Settings (HVAC, Elevator, سباكة…)", level: "error" });
        continue;
      }
      const e = byPhone.get(s(r.value.phone));
      const ref = { categoryId: cat.id };
      if (!e) {
        out.items.push({ row: r.row, action: "new", value: r.value, ref });
        continue;
      }
      const unchanged = same(e.name, r.value.name) && same(e.nameAr, r.value.nameAr) && e.categoryId === cat.id && (!r.value.email || same(e.email, r.value.email)) && e.isActive === r.value.isActive;
      out.items.push({ row: r.row, action: unchanged ? "unchanged" : "update", value: r.value, existingId: e.id, ref });
    }
    return out;
  },
  async apply(items) {
    const fresh = items.filter((i) => i.action === "new");
    if (fresh.length) {
      await db.contractor.createMany({
        data: fresh.map(({ value: v, ref }) => ({ name: s(v.name), nameAr: s(v.nameAr), categoryId: s(ref?.categoryId), phone: s(v.phone), email: (v.email as string) || null, isActive: Boolean(v.isActive) })),
      });
    }
    const changed = items.filter((i) => i.action === "update");
    for (const { value: v, existingId, ref } of changed) {
      await db.contractor.update({
        where: { id: existingId },
        data: { name: s(v.name), nameAr: s(v.nameAr), categoryId: s(ref?.categoryId), ...(v.email ? { email: s(v.email) } : {}), isActive: Boolean(v.isActive) },
      });
    }
    return { created: fresh.length, updated: changed.length, unchanged: items.filter((i) => i.action === "unchanged").length };
  },
};

// ───────────────────────── assets ─────────────────────────

const assets: Handler = {
  async analyze(rows, ctx) {
    const out = empty();
    const findCategory = await loadCategories();
    const lookup = await loadUnits(ctx.compoundId);
    const existing = await db.asset.findMany({
      where: { assetCode: { in: rows.map((r) => s(r.value.assetCode)) } },
      select: { id: true, assetCode: true, compoundId: true, name: true, nameAr: true, type: true, categoryId: true, buildingId: true, unitId: true, location: true, installationDate: true, manufacturer: true, model: true, serialNumber: true, warrantyExpiry: true, status: true },
    });
    const byCode = new Map(existing.map((a) => [a.assetCode, a]));
    for (const r of rows) {
      const v = r.value;
      let categoryId: string | null = null;
      if (v.category) {
        const c = findCategory(s(v.category));
        if (c) categoryId = c.id;
        else out.issues.push({ row: r.row, column: "Category / التصنيف", value: s(v.category), message: "Unknown category — left empty", level: "warning" });
      }
      let unitId: string | null = null;
      let buildingId: string | null = null;
      if (v.unit) {
        const u = lookup.unitByCode.get(s(v.unit));
        if (!u || u.building.compoundId !== ctx.compoundId) {
          out.issues.push({ row: r.row, column: "Unit code / رقم الوحدة", value: s(v.unit), message: "Unit not found — import units first (Units & buildings)", level: "error" });
          continue;
        }
        unitId = u.id;
        buildingId = u.buildingId;
      } else if (v.building) {
        const b = lookup.buildingByCode.get(s(v.building));
        if (!b) {
          out.issues.push({ row: r.row, column: "Building / المبنى", value: s(v.building), message: "Building not found — import units first (Units & buildings)", level: "error" });
          continue;
        }
        buildingId = b.id;
      }
      const ref = { categoryId, unitId, buildingId };
      const e = byCode.get(s(v.assetCode));
      if (e && e.compoundId !== ctx.compoundId) {
        out.issues.push({ row: r.row, column: "Asset code / كود الأصل", value: s(v.assetCode), message: "This asset code belongs to another compound", level: "error" });
        continue;
      }
      if (!e) {
        out.items.push({ row: r.row, action: "new", value: v, ref });
        continue;
      }
      const unchanged =
        same(e.name, v.name) && same(e.nameAr, v.nameAr) && same(e.type, v.assetType) && (!categoryId || e.categoryId === categoryId) && e.unitId === unitId && e.buildingId === buildingId &&
        same(e.location, v.location) && dayStr(e.installationDate) === s(v.installed) && same(e.manufacturer, v.manufacturer) && same(e.model, v.model) && same(e.serialNumber, v.serial) &&
        dayStr(e.warrantyExpiry) === s(v.warranty) && e.status === v.status;
      out.items.push({ row: r.row, action: unchanged ? "unchanged" : "update", value: v, existingId: e.id, ref });
    }
    return out;
  },
  async apply(items, ctx) {
    const data = ({ value: v, ref }: Item) => ({
      name: s(v.name),
      nameAr: (v.nameAr as string) || null,
      type: s(v.assetType),
      categoryId: (ref?.categoryId as string) || null,
      buildingId: (ref?.buildingId as string) || null,
      unitId: (ref?.unitId as string) || null,
      location: s(v.location),
      installationDate: toDate(v.installed),
      manufacturer: (v.manufacturer as string) || null,
      model: (v.model as string) || null,
      serialNumber: (v.serial as string) || null,
      warrantyExpiry: toDate(v.warranty),
      status: v.status as AssetStatus,
    });
    const fresh = items.filter((i) => i.action === "new");
    if (fresh.length) await db.asset.createMany({ data: fresh.map((i) => ({ assetCode: s(i.value.assetCode), compoundId: ctx.compoundId, ...data(i) })), skipDuplicates: true });
    const changed = items.filter((i) => i.action === "update");
    for (let k = 0; k < changed.length; k += 100) {
      await db.$transaction(changed.slice(k, k + 100).map((i) => db.asset.update({ where: { id: i.existingId }, data: data(i) as Prisma.AssetUncheckedUpdateInput })));
    }
    return { created: fresh.length, updated: changed.length, unchanged: items.filter((i) => i.action === "unchanged").length };
  },
};

// ───────────────────────── maintenance history ─────────────────────────

const history: Handler = {
  async analyze(rows, ctx) {
    const out = empty();
    const codes = [...new Set(rows.map((r) => s(r.value.assetCode)))];
    const found = await db.asset.findMany({ where: { assetCode: { in: codes }, compoundId: ctx.compoundId }, select: { id: true, assetCode: true } });
    const assetId = new Map(found.map((a) => [a.assetCode, a.id]));
    const existing = await db.assetMaintenance.findMany({ where: { assetId: { in: found.map((a) => a.id) } }, select: { assetId: true, date: true, description: true } });
    const seen = new Set(existing.map((e) => `${e.assetId}|${dayStr(e.date)}|${e.description.trim().toLowerCase()}`));
    for (const r of rows) {
      const id = assetId.get(s(r.value.assetCode));
      if (!id) {
        out.issues.push({ row: r.row, column: "Asset code / كود الأصل", value: s(r.value.assetCode), message: "Asset not found — import assets first", level: "error" });
        continue;
      }
      const key = `${id}|${s(r.value.date)}|${s(r.value.description).trim().toLowerCase()}`;
      out.items.push({ row: r.row, action: seen.has(key) ? "unchanged" : "new", value: r.value, ref: { assetId: id } });
    }
    return out;
  },
  async apply(items) {
    const fresh = items.filter((i) => i.action === "new");
    if (fresh.length) {
      await db.assetMaintenance.createMany({
        data: fresh.map(({ value: v, ref }) => ({
          assetId: s(ref?.assetId),
          date: toDate(v.date)!,
          type: v.kind as MaintenanceType,
          description: s(v.description),
          cost: v.cost === null || v.cost === undefined ? null : Number(v.cost),
          performedBy: (v.performedBy as string) || null,
        })),
      });
    }
    return { created: fresh.length, updated: 0, unchanged: items.filter((i) => i.action === "unchanged").length };
  },
};

export const HANDLERS: Record<ImportType, Handler> = { residents, units, technicians, contractors, assets, history };

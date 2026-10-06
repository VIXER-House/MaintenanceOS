/** Master-data CRUD rules: validation, archive-instead-of-delete, permissions, audit, custom categories in the AI. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRecord, deleteRecord, resetPassword, setActive, updateRecord } from "@/server/services/manage.service";
import { classifyRequest } from "@/server/services/ai.service";
import { invalidateCategoryCatalog } from "@/server/services/category-catalog.service";
import { getMockWhatsAppProvider } from "@/server/providers/whatsapp";
import { handleInboundMessage } from "@/server/services/intake.service";
import type { Actor } from "@/server/services/actor";

let dbUp = false;
const T = `M${Date.now().toString().slice(-5)}`;
const tail = Date.now().toString().slice(-4);
let manager: Actor;
let admin: Actor;

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = (await db.user.count()) > 0;
  } catch {
    dbUp = false;
  }
  if (!dbUp) return;
  const mm = await db.user.findFirstOrThrow({ where: { role: "MAINTENANCE_MANAGER" } });
  const ad = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  manager = { type: "STAFF", name: mm.name, userId: mm.id, role: mm.role };
  admin = { type: "STAFF", name: ad.name, userId: ad.id, role: ad.role };
});
afterAll(async () => {
  if (dbUp) {
    const rs = await db.resident.findMany({ where: { phone: { startsWith: `+201077${tail}` } }, select: { id: true } });
    await db.ticketMessage.deleteMany({ where: { conversation: { residentId: { in: rs.map((r) => r.id) } } } });
    await db.conversation.deleteMany({ where: { residentId: { in: rs.map((r) => r.id) } } });
    await db.ticket.deleteMany({ where: { residentId: { in: rs.map((r) => r.id) } } });
    await db.resident.deleteMany({ where: { id: { in: rs.map((r) => r.id) } } });
    await db.unit.deleteMany({ where: { code: { startsWith: T } } });
    await db.building.deleteMany({ where: { code: { startsWith: T } } });
    const techs = await db.technician.findMany({ where: { name: { startsWith: T } } });
    await db.technician.deleteMany({ where: { id: { in: techs.map((t) => t.id) } } });
    await db.user.deleteMany({ where: { OR: [{ id: { in: techs.map((t) => t.userId) } }, { email: { startsWith: T.toLowerCase() } }] } });
    await db.category.deleteMany({ where: { key: `${T}_POOL` } });
    invalidateCategoryCatalog();
  }
  await db.$disconnect();
});

describe.runIf(process.env.DATABASE_URL)("master data management (integration)", () => {
  it("building → unit → resident: validation, edit, delete rules", async () => {
    if (!dbUp) return;
    await createRecord("buildings", { code: `${T}B`, floors: 3 }, manager);
    const unit = (await createRecord("units", { code: `${T}B-101`, building: `${T.toLowerCase()}b`, floor: 1 }, manager)) as { id: string };
    await expect(createRecord("residents", { name: "X", phone: "123", unit: `${T}B-101` }, manager)).rejects.toThrow(/mobile/i);
    await expect(createRecord("residents", { name: "X", phone: `01077${tail}01`, unit: "NOPE-1" }, manager)).rejects.toThrow(/not found/);
    const r = (await createRecord("residents", { name: "Res One", phone: `01077${tail}01`, unit: `${T}b 101`, isOwner: "false" }, manager)) as { id: string; isOwner: boolean; phone: string };
    expect(r.phone).toBe(`+201077${tail}01`);
    expect(r.isOwner).toBe(false);
    await expect(createRecord("residents", { name: "Dup", phone: `+201077${tail}01`, unit: `${T}B-101` }, manager)).rejects.toThrow(/already exists/);
    await updateRecord("residents", r.id, { name: "Res Renamed", phone: `01077${tail}01`, unit: `${T}B-101`, language: "en" }, manager);
    expect((await db.resident.findUniqueOrThrow({ where: { id: r.id } })).language).toBe("en");
    await expect(deleteRecord("units", unit.id, manager)).rejects.toThrow(/linked to 1 residents/);
    await deleteRecord("residents", r.id, manager);
    await deleteRecord("units", unit.id, manager);
    const log = await db.auditLog.findMany({ where: { entityId: r.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    expect(log[1].changes).toMatchObject({ name: { from: "Res One", to: "Res Renamed" } });
  });

  it("a resident with tickets is archived, and comes back through WhatsApp as unverified", async () => {
    if (!dbUp) return;
    const unit = await db.unit.findFirstOrThrow({ where: { code: "A01-301" } });
    const r = (await createRecord("residents", { name: "Has Tickets", phone: `01077${tail}02`, unit: unit.code }, manager)) as { id: string; phone: string };
    const [m] = await getMockWhatsAppProvider().receiveMessage({ from: r.phone, type: "text", text: "الكهربا قاطعة في الشقة" });
    await handleInboundMessage(m, "mock", { skipDuplicateCheck: true });
    const err = await deleteRecord("residents", r.id, manager).catch((e) => e);
    expect(err.code).toBe("IN_USE");
    expect(err.details.canArchive).toBe(true);
    await setActive("residents", r.id, false, manager);
    const [m2] = await getMockWhatsAppProvider().receiveMessage({ from: r.phone, type: "text", text: "السلام عليكم" });
    const back = await handleInboundMessage(m2, "mock");
    expect(back.action).toBe("registration_requested");
    const after = await db.resident.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.isActive).toBe(true);
    expect(after.verified).toBe(false);
    expect(after.unitId).toBeNull();
  });

  it("technicians get a login; archived ones lose access and are never auto-assigned", async () => {
    if (!dbUp) return;
    const tech = (await createRecord("technicians", { name: `${T} Tech`, phone: `01077${tail}10`, skills: ["PLUMBING"] }, manager)) as { id: string; userId: string; credentials: { email: string; password: string } };
    expect(tech.credentials.password).toHaveLength(8);
    await expect(createRecord("technicians", { name: "x", phone: `01077${tail}11`, skills: ["ROCKETS"] }, manager)).rejects.toThrow(/Unknown skill/);
    const reset = await resetPassword("technicians", tech.id, manager);
    expect(reset.password).not.toBe(tech.credentials.password);
    await setActive("technicians", tech.id, false, manager);
    expect((await db.user.findUniqueOrThrow({ where: { id: tech.userId } })).isActive).toBe(false);
    const { getAssignmentRecommendation } = await import("@/server/services/assignment.service");
    const rec = await getAssignmentRecommendation("PLUMBING", "PLUMBING");
    expect(rec.technician?.technician.id).not.toBe(tech.id);
    await deleteRecord("technicians", tech.id, manager); // no tickets → real delete
    expect(await db.user.findUnique({ where: { id: tech.userId } })).toBeNull();
  });

  it("staff users: only admins create admins; can't deactivate yourself", async () => {
    if (!dbUp) return;
    await expect(createRecord("users", { name: "A", email: `${T.toLowerCase()}a@x.com`, role: "ADMIN" }, manager)).rejects.toThrow(/Only an admin/);
    const u = (await createRecord("users", { name: "MM", email: `${T.toLowerCase()}mm@x.com`, role: "MAINTENANCE_MANAGER" }, admin)) as { id: string; credentials: { password: string } };
    expect(u.credentials.password).toBeTruthy();
    await expect(setActive("users", manager.userId!, false, manager)).rejects.toThrow(/your own account/);
    await setActive("users", u.id, false, manager);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(false);
  });

  it("a category added by a manager is used by the AI; archiving hides it", async () => {
    if (!dbUp) return;
    const c = (await createRecord("categories", { key: `${T}_POOL`, nameEn: "Swimming pool", nameAr: "حمام السباحة", description: "Pool pumps, filters, water quality", keywords: ["البيسين", "حمام السباحة", "pool"] }, manager)) as { id: string; key: string };
    const yes = await classifyRequest({ text: "البيسين مياهه خضرا والفلتر مش شغال" });
    expect(yes.classification.category).toBe(c.key);
    await expect(deleteRecord("categories", (await db.category.findUniqueOrThrow({ where: { key: "PAINTING" } })).id, manager)).rejects.toThrow(/built-in/);
    await setActive("categories", c.id, false, manager);
    const no = await classifyRequest({ text: "البيسين مياهه خضرا والفلتر مش شغال" });
    expect(no.classification.category).not.toBe(c.key);
    await setActive("categories", c.id, true, manager);
    await deleteRecord("categories", c.id, manager); // unused → can be deleted
  });
});

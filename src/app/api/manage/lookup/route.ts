import { MANAGERS, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { route } from "@/server/http/api";

/** Type-ahead suggestions for unit / building codes (compounds can have thousands of units). */
export const GET = route(async (req) => {
  await requireApiUser(MANAGERS);
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const q = (url.searchParams.get("q") ?? "").trim();
  if (type === "buildings") {
    const rows = await db.building.findMany({ where: q ? { code: { contains: q, mode: "insensitive" } } : {}, select: { code: true, name: true }, take: 20, orderBy: { code: "asc" } });
    return { items: rows.map((r) => ({ value: r.code, label: r.name && r.name !== r.code ? `${r.code} · ${r.name}` : r.code })) };
  }
  const rows = await db.unit.findMany({
    where: q ? { code: { contains: q.replace(/\s+/g, ""), mode: "insensitive" } } : {},
    select: { code: true, type: true, building: { select: { code: true } } },
    take: 20,
    orderBy: { code: "asc" },
  });
  // also match "a01 101" against "A01-101"
  const extra =
    rows.length < 20 && /[\s\-/]/.test(q)
      ? await db.unit.findMany({ where: { code: { contains: q.split(/[\s\-/]+/)[0], mode: "insensitive" } }, select: { code: true, type: true, building: { select: { code: true } } }, take: 20 })
      : [];
  const seen = new Set<string>();
  return {
    items: [...rows, ...extra]
      .filter((r) => !seen.has(r.code) && seen.add(r.code))
      .slice(0, 20)
      .map((r) => ({ value: r.code, label: `${r.code} · ${r.type} · ${r.building.code}` })),
  };
});

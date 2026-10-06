import { db } from "@/lib/db";
import { CATEGORY_BY_KEY } from "@/server/domain/categories";
import type { CategoryCatalogEntry } from "@/server/providers/ai/types";

/**
 * Active categories as the AI should see them: built-in definitions + anything managers
 * added or edited (names, description, extra keywords). Cached briefly; invalidated on edit.
 */
let cache: { at: number; entries: CategoryCatalogEntry[] } | null = null;
const TTL_MS = 30_000;

export async function getActiveCategoryCatalog(): Promise<CategoryCatalogEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  const rows = await db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const entries = rows.map((r) => {
    const builtIn = CATEGORY_BY_KEY[r.key as keyof typeof CATEGORY_BY_KEY];
    return {
      key: r.key,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      description: r.description,
      keywords: [...new Set([...(builtIn?.keywords ?? []), ...(r.keywords ?? []), r.nameEn, r.nameAr].filter(Boolean))],
      builtIn: Boolean(builtIn),
    };
  });
  if (!entries.some((e) => e.key === "OTHER")) {
    entries.push({ key: "OTHER", nameEn: "Other", nameAr: "أخرى", description: "Anything else", keywords: [], builtIn: true });
  }
  cache = { at: Date.now(), entries };
  return entries;
}

export function invalidateCategoryCatalog() {
  cache = null;
}

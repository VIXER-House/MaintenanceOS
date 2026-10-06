import { db } from "@/lib/db";
import { CHUNK_SIZE, type ImportIssue, type ImportType, type RawRow } from "@/lib/import/core";
import { IMPORT_DEFINITIONS, checkRows } from "@/lib/import/definitions";
import { AppError } from "../errors";
import { HANDLERS, type Action, type ApplyResult } from "./handlers";

/**
 * Server side of the data import. The browser reads the whole file and sends it in
 * chunks of ≤ CHUNK_SIZE rows; every chunk is re-checked here (format + database)
 * before anything is saved, so the server never trusts the browser's checks.
 */

export interface ChunkPreview {
  issues: ImportIssue[];
  actions: { row: number; action: Action }[];
  newUnits: string[];
  newBuildings: string[];
  newTeams: string[];
}

async function compoundOrThrow(compoundId?: string | null) {
  const c = compoundId ? await db.compound.findUnique({ where: { id: compoundId } }) : await db.compound.findFirst({ orderBy: { createdAt: "asc" } });
  if (!c) throw new AppError("Compound not found", 404, "NOT_FOUND");
  return c;
}

async function analyzeChunk(type: ImportType, compoundId: string, rows: RawRow[]) {
  if (rows.length > CHUNK_SIZE) throw new AppError(`Send at most ${CHUNK_SIZE} rows per request`, 400, "CHUNK_TOO_LARGE");
  const def = IMPORT_DEFINITIONS[type];
  const { parsed, issues } = checkRows(def, rows);
  const result = await HANDLERS[type].analyze(parsed, { compoundId });
  return { ...result, issues: [...issues, ...result.issues].sort((a, b) => a.row - b.row) };
}

export async function previewChunk(type: ImportType, compoundId: string | null, rows: RawRow[]): Promise<ChunkPreview & { compound: { id: string; name: string } }> {
  const compound = await compoundOrThrow(compoundId);
  const r = await analyzeChunk(type, compound.id, rows);
  return {
    compound: { id: compound.id, name: compound.name },
    issues: r.issues,
    actions: r.items.map((i) => ({ row: i.row, action: i.action })),
    newUnits: r.newUnits,
    newBuildings: r.newBuildings,
    newTeams: r.newTeams,
  };
}

/** Saves the rows of this chunk that pass every check; rows with errors are skipped and reported. */
export async function commitChunk(type: ImportType, compoundId: string | null, rows: RawRow[]): Promise<ApplyResult & { skipped: number; issues: ImportIssue[] }> {
  const compound = await compoundOrThrow(compoundId);
  const r = await analyzeChunk(type, compound.id, rows);
  const errorRows = new Set(r.issues.filter((i) => i.level === "error").map((i) => i.row));
  const items = r.items.filter((i) => !errorRows.has(i.row));
  const applied = await HANDLERS[type].apply(items, { compoundId: compound.id });
  return { ...applied, skipped: rows.length - items.length, issues: r.issues };
}

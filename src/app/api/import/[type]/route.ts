import { z } from "zod";
import { MANAGERS, requireApiUser } from "@/lib/auth";
import { CHUNK_SIZE, isImportType } from "@/lib/import/core";
import { parseBody, route } from "@/server/http/api";
import { AppError } from "@/server/services/errors";
import { commitChunk, previewChunk } from "@/server/services/import";

export const maxDuration = 60;

const Body = z.object({
  mode: z.enum(["preview", "commit"]),
  compoundId: z.string().nullish(),
  rows: z
    .array(z.object({ row: z.number().int().positive(), values: z.record(z.string(), z.string().max(2000)) }))
    .min(1)
    .max(CHUNK_SIZE),
});

/** One chunk (≤ 1,000 rows) of an import: preview = check only, commit = check + save. */
export const POST = route(async (req, { type }) => {
  await requireApiUser(MANAGERS);
  if (!isImportType(type)) throw new AppError("Unknown import type", 404, "NOT_FOUND");
  const body = await parseBody(req, Body);
  return body.mode === "preview" ? previewChunk(type, body.compoundId ?? null, body.rows) : commitChunk(type, body.compoundId ?? null, body.rows);
});

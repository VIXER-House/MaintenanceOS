import { MANAGERS, requireApiUser } from "@/lib/auth";
import { isImportType } from "@/lib/import/core";
import { route } from "@/server/http/api";
import { AppError } from "@/server/services/errors";
import { buildImportTemplate } from "@/server/services/import/template";

/** Excel template (bilingual headers, examples, drop-downs, instructions sheet). */
export const GET = route(async (_req, { type }) => {
  await requireApiUser(MANAGERS);
  if (!isImportType(type)) throw new AppError("Unknown import type", 404, "NOT_FOUND");
  const buf = await buildImportTemplate(type);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="maintenanceos-${type}-template.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});

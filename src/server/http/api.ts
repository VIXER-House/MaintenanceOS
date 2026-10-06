import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/server/services/errors";
import { InvalidTransitionError } from "@/server/engines/lifecycle/ticket-lifecycle";
import { QuotationValidationError } from "@/server/engines/quotation/quotation-engine";

type Ctx = { params: Promise<Record<string, string>> };

/** Uniform JSON error contract: { error: { code, message, details? } } */
export function errorResponse(e: unknown) {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const message = first ? `${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}` : "Invalid request";
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message, details: e.flatten() } }, { status: 400 });
  }
  if (e instanceof InvalidTransitionError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 409 });
  }
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found" } }, { status: 404 });
  }
  if (e instanceof QuotationValidationError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 400 });
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/** Wrap a route handler with error mapping. */
export function route<T>(fn: (req: NextRequest, params: Record<string, string>) => Promise<T>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      const data = await fn(req, params);
      if (data instanceof Response) return data;
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown = {};
  try {
    const text = await req.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("Body must be valid JSON", 400, "INVALID_JSON");
  }
  return schema.parse(json);
}

import { NextResponse, type NextRequest } from "next/server";

/** Replaced by /api/import/residents/template. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/api/import/residents/template", req.url));
}

import { NextResponse } from "next/server";

/** Replaced by /api/import/residents (chunked, browser-side file reading). */
export function POST() {
  return NextResponse.json({ error: { code: "GONE", message: "Use /import (POST /api/import/residents)" } }, { status: 410 });
}

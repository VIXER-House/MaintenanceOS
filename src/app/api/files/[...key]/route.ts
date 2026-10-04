import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse } from "@/server/http/api";
import { readStoredFile } from "@/server/services/storage.service";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm", mp4: "video/mp4" };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    await requireApiUser();
    const { key } = await ctx.params;
    const path = key.join("/");
    const buf = await readStoredFile(path);
    if (!buf) return NextResponse.json({ error: { code: "NOT_FOUND", message: "File not found" } }, { status: 404 });
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return errorResponse(e);
  }
}

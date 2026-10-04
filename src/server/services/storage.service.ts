import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { getConfig } from "@/lib/config";

/**
 * Local-disk file storage for attachments (images, voice notes, videos).
 * Files are served through /api/files/[...key] (auth-protected).
 * Production: replace with S3/R2/Azure Blob behind the same two functions.
 */
function root() {
  // Serverless hosts (Vercel) only allow writes under /tmp
  if (process.env.VERCEL && !process.env.UPLOAD_DIR) return "/tmp/uploads";
  return path.resolve(process.cwd(), getConfig().UPLOAD_DIR);
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "video/mp4": "mp4",
};

export async function saveFile(buffer: Buffer, fileName: string | undefined, mimeType: string) {
  const month = new Date().toISOString().slice(0, 7);
  const ext = MIME_EXT[mimeType] ?? fileName?.split(".").pop() ?? "bin";
  const base = (fileName ?? `file.${ext}`).replace(/[^\w.\-]+/g, "_").slice(-60);
  const key = `${month}/${randomUUID().slice(0, 8)}-${base}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer);
  return { key, url: `/api/files/${key}`, size: buffer.length, fileName: fileName ?? base };
}

export async function readStoredFile(key: string): Promise<Buffer | null> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root())) return null; // path traversal guard
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export function attachmentTypeFor(mimeType: string): "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

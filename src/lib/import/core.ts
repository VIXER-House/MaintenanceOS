/**
 * Data-import core — pure functions shared by the browser (reads the file, checks it)
 * and the server (re-checks every row before saving). No database, no Node APIs.
 */
import { toLatinDigits } from "@/server/domain/unit-codes";

export type ImportType = "residents" | "units" | "technicians" | "contractors" | "assets" | "history";
export const IMPORT_TYPES: ImportType[] = ["residents", "units", "technicians", "contractors", "assets", "history"];
export const isImportType = (v: unknown): v is ImportType => typeof v === "string" && (IMPORT_TYPES as string[]).includes(v);

export interface ImportIssue {
  row: number;
  column?: string;
  value?: string;
  message: string;
  level: "error" | "warning";
}

/** One spreadsheet row, cells keyed by field name. */
export interface RawRow {
  row: number;
  values: Record<string, string>;
}

export interface ColumnDef {
  field: string;
  header: string;
  aliases: string[];
  required?: boolean;
  width?: number;
  /** Store as text in the template (keeps leading zeros) */
  text?: boolean;
  examples: string[];
  list?: string[];
}

// ───────────────────────── headers ─────────────────────────

export const normHeader = (s: string) =>
  toLatinDigits(String(s ?? ""))
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s_\-.*:()]+/g, "");

export function fieldForHeader(header: string, columns: ColumnDef[]): string | null {
  // "Unit code / رقم الوحدة" → try the whole title and each half
  const parts = [header, ...String(header).split(/[/|\\]/)].map(normHeader).filter(Boolean);
  for (const c of columns) {
    const names = new Set([c.header, ...c.header.split("/"), ...c.aliases].map(normHeader));
    if (parts.some((p) => names.has(p))) return c.field;
  }
  return null;
}

export interface MappedTable {
  headerRow: number;
  columns: { header: string; field: string | null }[];
  rows: RawRow[];
  missing: string[];
}

/** Find the header row (first 10 rows), map columns, return non-empty data rows. */
export function mapTable(table: string[][], columns: ColumnDef[]): MappedTable | null {
  const idx = table.findIndex((r, i) => i < 10 && (r ?? []).filter((h) => fieldForHeader(h, columns)).length >= 2);
  if (idx < 0) return null;
  const used = new Set<string>();
  const mapped = (table[idx] ?? []).map((h) => {
    const f = fieldForHeader(h, columns);
    if (f && !used.has(f)) {
      used.add(f);
      return { header: h, field: f };
    }
    return { header: h, field: null };
  });
  const rows: RawRow[] = [];
  table.slice(idx + 1).forEach((cells, i) => {
    if (!(cells ?? []).some((c) => String(c ?? "").trim())) return;
    const values: Record<string, string> = {};
    mapped.forEach((m, c) => {
      if (m.field) values[m.field] = String(cells[c] ?? "").trim();
    });
    rows.push({ row: idx + 2 + i, values });
  });
  const missing = columns.filter((c) => c.required && !used.has(c.field)).map((c) => c.header);
  return { headerRow: idx + 1, columns: mapped, rows, missing };
}

// ───────────────────────── value parsers ─────────────────────────

/** Egyptian-first phone normalisation → E.164 (+20…). null when it can't be a mobile number. */
export function normalizePhoneNumber(raw: string): string | null {
  const original = toLatinDigits(String(raw ?? "")).trim();
  if (!original) return null;
  let d = original.replace(/[^\d+]/g, "");
  const hadPlus = d.startsWith("+");
  d = d.replace(/\+/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01[0125]\d{8}$/.test(d)) return `+2${d}`;
  if (/^1[0125]\d{8}$/.test(d)) return `+20${d}`; // Excel dropped the leading 0
  if (/^201[0125]\d{8}$/.test(d)) return `+${d}`;
  if (d.startsWith("20")) return null;
  if ((hadPlus || original.startsWith("00")) && /^[1-9]\d{7,14}$/.test(d)) return `+${d}`;
  return null;
}

/** Landlines allowed too (contractors): Egyptian 0X…, or anything in +country format. */
export function normalizeAnyPhone(raw: string): string | null {
  const mobile = normalizePhoneNumber(raw);
  if (mobile) return mobile;
  const d = toLatinDigits(String(raw ?? "")).replace(/[^\d]/g, "");
  if (/^0[2-9]\d{7,9}$/.test(d)) return `+20${d.slice(1)}`;
  if (/^20[2-9]\d{7,9}$/.test(d)) return `+${d}`;
  return null;
}

/** Dates as Excel gives them or as people type them: 2024-03-15, 15/03/2024, 15-3-2024, Excel serial. */
export function parseDate(raw: string): Date | null | "invalid" {
  const s = toLatinDigits(String(raw ?? "")).trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]]; // day first (Egypt)
  else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return dt;
  } else return "invalid";
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return "invalid";
  return new Date(Date.UTC(y, m - 1, d));
}

export function parseNumber(raw: string): number | null | "invalid" {
  const s = toLatinDigits(String(raw ?? "")).replace(/[,\s٬]/g, "").replace(/(egp|le|جنيه|ج\.?م)$/i, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "invalid";
}

export function parseBool(raw: string, fallback: boolean): boolean | "invalid" {
  const s = normHeader(raw);
  if (!s) return fallback;
  if (["yes", "y", "true", "1", "active", "نعم", "اه", "ايوه", "فعال", "نشط"].includes(s)) return true;
  if (["no", "n", "false", "0", "inactive", "لا", "غيرفعال", "موقوف", "متوقف"].includes(s)) return false;
  return "invalid";
}

/** Pick one of several allowed values from English/Arabic words. */
export function parseChoice<T extends string>(raw: string, options: Record<T, string[]>, fallback: NoInfer<T>): T | "invalid" {
  const s = normHeader(raw);
  if (!s) return fallback;
  for (const [value, words] of Object.entries(options) as [T, string[]][]) {
    if (normHeader(value) === s || words.map(normHeader).includes(s)) return value;
  }
  return "invalid";
}

export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
export const splitList = (s: string) =>
  String(s ?? "")
    .split(/[,،;\n|+]/)
    .map((x) => x.trim())
    .filter(Boolean);

// ───────────────────────── CSV ─────────────────────────

/** RFC-4180 CSV (quotes, comma or semicolon, CRLF). */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Text of an ExcelJS cell value (rich text, formulas, dates, hyperlinks). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    if ("result" in o) return cellText(o.result);
  }
  return String(v);
}

export const CHUNK_SIZE = 1000;
export const MAX_ROWS = 100_000;

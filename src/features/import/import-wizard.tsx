"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, KeyRound, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useI18n } from "@/lib/i18n/client";
import { CHUNK_SIZE, MAX_ROWS, cellText, mapTable, parseCsv, type ImportIssue, type ImportType, type RawRow } from "@/lib/import/core";
import { IMPORT_DEFINITIONS, checkRows, type ParsedRow } from "@/lib/import/definitions";
import { cn } from "@/lib/utils";

type Action = "new" | "update" | "unchanged";
interface Review {
  fileName: string;
  compoundName: string;
  total: number;
  raw: RawRow[];
  parsed: ParsedRow[];
  issues: ImportIssue[];
  actions: Map<number, Action>;
  newUnits: number;
  newBuildings: number;
  newTeams: number;
  ignoredColumns: string[];
}
interface Done {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  credentials: { name: string; phone: string; email: string; password: string }[];
  stopped?: string;
  processed: number;
  total: number;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

async function post<T>(type: ImportType, body: unknown): Promise<T> {
  const res = await fetch(`/api/import/${type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

/** Read .xlsx (first sheet with recognisable headers) or .csv entirely in the browser. */
async function readFile(file: File, type: ImportType): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseCsv(await file.text());
  if (!name.endsWith(".xlsx")) throw new Error("Upload an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and “Save as” .xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const def = IMPORT_DEFINITIONS[type];
  let first: string[][] | null = null;
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    const columnCount = ws.columnCount; // computed by scanning the whole sheet — read it once
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const values: string[] = [];
      for (let c = 1; c <= Math.max(columnCount, r.cellCount); c++) values.push(cellText(r.getCell(c).value).trim());
      rows[n - 1] = values;
    });
    const table = Array.from(rows, (r) => r ?? []);
    first ??= table;
    if (mapTable(table, def.columns)) return table;
  }
  return first ?? [];
}

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportWizard({ compounds, initialType }: { compounds: { id: string; name: string }[]; initialType: ImportType }) {
  const { t, locale } = useI18n();
  const tt = t.residentsImport;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<ImportType>(initialType);
  const [compoundId, setCompoundId] = useState(compounds[0]?.id ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const def = IMPORT_DEFINITIONS[type];

  const reset = () => {
    setReview(null);
    setDone(null);
    setSkipInvalid(false);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const errorRows = useMemo(() => new Set(review?.issues.filter((i) => i.level === "error").map((i) => i.row) ?? []), [review]);
  const counts = useMemo(() => {
    const c = { new: 0, update: 0, unchanged: 0 };
    review?.actions.forEach((a, row) => {
      if (!errorRows.has(row)) c[a]++;
    });
    return c;
  }, [review, errorRows]);

  async function check(file: File) {
    reset();
    try {
      setProgress({ label: tt.reading, done: 0, total: 0 });
      const table = await readFile(file, type);
      const mapped = mapTable(table, def.columns);
      if (!mapped) throw new Error(tt.noHeader);
      if (mapped.missing.length) throw new Error(fill(tt.missingColumns, { cols: mapped.missing.join("، ") }));
      if (mapped.rows.length > MAX_ROWS) throw new Error(fill(tt.tooMany, { n: mapped.rows.length, max: MAX_ROWS }));
      const { parsed, issues } = checkRows(def, mapped.rows);
      const fileErrors = new Set(issues.filter((i) => i.level === "error").map((i) => i.row));
      const toCheck = mapped.rows.filter((r) => !fileErrors.has(r.row));
      const actions = new Map<number, Action>();
      const units = new Set<string>(), buildings = new Set<string>(), teams = new Set<string>();
      const serverIssues: ImportIssue[] = [];
      let compoundName = "";
      for (let i = 0; i < toCheck.length; i += CHUNK_SIZE) {
        setProgress({ label: fill(tt.checkingProgress, { done: i, total: toCheck.length }), done: i, total: toCheck.length });
        const r = await post<{ compound: { name: string }; issues: ImportIssue[]; actions: { row: number; action: Action }[]; newUnits: string[]; newBuildings: string[]; newTeams: string[] }>(type, {
          mode: "preview",
          compoundId,
          rows: toCheck.slice(i, i + CHUNK_SIZE),
        });
        compoundName = r.compound.name;
        r.actions.forEach((a) => actions.set(a.row, a.action));
        r.newUnits.forEach((u) => units.add(u));
        r.newBuildings.forEach((b) => buildings.add(b));
        r.newTeams.forEach((x) => teams.add(x));
        // the browser already reported format problems; keep only what the database check adds
        serverIssues.push(...r.issues.filter((x) => !issues.some((y) => y.row === x.row && y.message === x.message)));
      }
      setReview({
        fileName: file.name,
        compoundName: compoundName || compounds.find((c) => c.id === compoundId)?.name || "",
        total: mapped.rows.length,
        raw: mapped.rows,
        parsed,
        issues: [...issues, ...serverIssues].sort((a, b) => a.row - b.row),
        actions,
        newUnits: units.size,
        newBuildings: buildings.size,
        newTeams: teams.size,
        ignoredColumns: mapped.columns.filter((c) => !c.field && c.header).map((c) => c.header),
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function runImport() {
    if (!review) return;
    const rows = review.raw.filter((r) => !errorRows.has(r.row) && review.actions.has(r.row) && review.actions.get(r.row) !== "unchanged");
    const result: Done = { created: 0, updated: 0, unchanged: counts.unchanged, skipped: errorRows.size, credentials: [], processed: 0, total: rows.length };
    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        setProgress({ label: fill(tt.importingProgress, { done: i, total: rows.length }), done: i, total: rows.length });
        const r = await post<{ created: number; updated: number; unchanged: number; skipped: number; credentials?: Done["credentials"] }>(type, { mode: "commit", compoundId, rows: rows.slice(i, i + CHUNK_SIZE) });
        result.created += r.created;
        result.updated += r.updated;
        result.unchanged += r.unchanged;
        result.skipped += r.skipped;
        result.credentials.push(...(r.credentials ?? []));
        result.processed = Math.min(rows.length, i + CHUNK_SIZE);
      }
      toast.success(tt.done);
    } catch (e) {
      result.stopped = (e as Error).message;
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
      setDone(result);
      router.refresh();
    }
  }

  const issuesCsv = () =>
    downloadCsv(`${type}-problems.csv`, [[tt.row, tt.column, tt.value, tt.problem, ""], ...(review?.issues ?? []).map((i) => [i.row, i.column ?? "", i.value ?? "", i.message, i.level])]);

  // ───────────── done ─────────────
  if (done) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className={cn("flex items-center gap-2 text-lg font-semibold", done.stopped ? "text-amber-700" : "text-emerald-700")}>
            {done.stopped ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} {done.stopped ? def.title[locale] : tt.done}
          </div>
          <p className="text-sm">{fill(tt.doneSummary, { created: done.created, updated: done.updated, unchanged: done.unchanged, skipped: done.skipped, units: review?.newUnits ?? 0 })}</p>
          {done.stopped && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{fill(tt.stopped, { done: done.processed, total: done.total, error: done.stopped })}</p>}
          {done.credentials.length > 0 && (
            <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50 p-4">
              <div className="flex items-center gap-2 font-medium text-sky-900"><KeyRound className="h-4 w-4" /> {tt.credentialsTitle} ({done.credentials.length})</div>
              <p className="text-xs text-sky-900">{tt.credentialsHint}</p>
              <Button size="sm" variant="outline" onClick={() => downloadCsv("technician-logins.csv", [["Name", "Mobile", "Email", "Temporary password"], ...done.credentials.map((c) => [c.name, c.phone, c.email, c.password])])}>
                <Download /> {tt.downloadCredentials}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset}>{tt.another}</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const importable = counts.new + counts.update;
  const busy = progress !== null;
  return (
    <div className="space-y-4">
      {/* type picker */}
      <Card>
        <CardHeader>
          <CardTitle>{tt.chooseType}</CardTitle>
          <CardDescription>{tt.order}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(IMPORT_DEFINITIONS).map((d) => (
            <button
              key={d.type}
              type="button"
              disabled={busy}
              onClick={() => {
                setType(d.type);
                reset();
                router.replace(`/import?type=${d.type}`, { scroll: false });
              }}
              className={cn("rounded-md border p-3 text-start transition hover:bg-muted/60", type === d.type && "border-primary bg-primary/5 ring-1 ring-primary")}
            >
              <div className="font-medium">{d.title[locale]}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{d.description[locale]}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tt.step1}</CardTitle>
            <CardDescription>{tt.step1Hint} {fill(tt.matchBy, { key: def.matchBy[locale] })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href={`/api/import/${type}/template`} download>
                <Download /> {tt.template} — {def.title[locale]}
              </a>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tt.step2}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {compounds.length > 1 && (
              <div className="space-y-1">
                <Label>{tt.compound}</Label>
                <Select value={compoundId} onChange={(e) => setCompoundId(e.target.value)} disabled={busy}>
                  {compounds.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) check(f);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Upload />} {tt.choose}
              </Button>
              {review && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground"><FileSpreadsheet className="h-4 w-4" /> {review.fileName}</span>
              )}
            </div>
            {progress && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{progress.label}</div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: progress.total ? `${Math.max(4, (progress.done / progress.total) * 100)}%` : "30%" }} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {review && (
        <Card>
          <CardHeader>
            <CardTitle>{tt.step3} — {def.title[locale]}</CardTitle>
            <CardDescription>{review.compoundName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {(
                [
                  [tt.rows, review.total, ""],
                  [tt.valid, counts.new + counts.update + counts.unchanged, "text-emerald-700"],
                  [tt.invalid, errorRows.size, errorRows.size ? "text-red-700" : ""],
                  [tt.actionNew, counts.new, ""],
                  [tt.updated, counts.update, ""],
                  [tt.unchanged, counts.unchanged, "text-muted-foreground"],
                  ...(type === "residents" || type === "units" ? [[tt.newUnits, review.newUnits, ""], [tt.newBuildings, review.newBuildings, ""]] : []),
                  ...(type === "technicians" ? [[tt.newTeams, review.newTeams, ""]] : []),
                ] as [string, number, string][]
              ).map(([label, value, cls]) => (
                <div key={label} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={cn("num text-xl font-semibold", cls)}>{value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            {review.ignoredColumns.length > 0 && <p className="text-xs text-amber-700">{fill(tt.unknownColumns, { cols: review.ignoredColumns.join("، ") })}</p>}

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{tt.issues} {review.issues.length > 0 && <span className="text-muted-foreground">({review.issues.length.toLocaleString()})</span>}</div>
                {review.issues.length > 0 && <Button size="sm" variant="outline" onClick={issuesCsv}><Download /> {tt.downloadIssues}</Button>}
              </div>
              {review.issues.length === 0 ? (
                <p className="text-sm text-emerald-700">{tt.noIssues}</p>
              ) : (
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <THead><TR><TH>{tt.row}</TH><TH /><TH>{tt.column}</TH><TH>{tt.value}</TH><TH>{tt.problem}</TH></TR></THead>
                    <TBody>
                      {review.issues.slice(0, 300).map((i, k) => (
                        <TR key={k}>
                          <TD className="num">{i.row}</TD>
                          <TD>
                            {i.level === "error" ? (
                              <span className="flex items-center gap-1 text-xs text-red-700"><XCircle className="h-3.5 w-3.5" /> {tt.error}</span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {tt.warning}</span>
                            )}
                          </TD>
                          <TD className="text-xs">{i.column}</TD>
                          <TD className="text-xs" dir="auto">{i.value}</TD>
                          <TD className="text-xs">{i.message}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>

            {review.parsed.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold">{tt.preview}</div>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <THead><TR><TH>{tt.row}</TH><TH>{tt.action}</TH><TH>{def.title[locale]}</TH><TH /></TR></THead>
                    <TBody>
                      {review.parsed
                        .filter((p) => !errorRows.has(p.row))
                        .slice(0, 50)
                        .map((p) => {
                          const a = review.actions.get(p.row);
                          const l = def.label(p.value);
                          return (
                            <TR key={p.row}>
                              <TD className="num">{p.row}</TD>
                              <TD>
                                <Badge variant="outline" className={a === "new" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : a === "update" ? "border-sky-200 bg-sky-50 text-sky-700" : "text-muted-foreground"}>
                                  {a === "new" ? tt.actionNew : a === "update" ? tt.actionUpdate : tt.actionUnchanged}
                                </Badge>
                              </TD>
                              <TD className="text-xs" dir="auto"><div className="font-medium">{l.main}</div>{l.sub && <div className="text-muted-foreground">{l.sub}</div>}</TD>
                              <TD className="text-xs text-muted-foreground" dir="ltr">{l.extra}</TD>
                            </TR>
                          );
                        })}
                    </TBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              {errorRows.size > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                  {tt.skipInvalid}
                </label>
              )}
              <Button disabled={busy || importable === 0 || (errorRows.size > 0 && !skipInvalid)} onClick={runImport}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {fill(tt.importN, { n: importable.toLocaleString() })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

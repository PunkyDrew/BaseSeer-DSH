import { object, text, PlanError } from "../domain/plan.ts";
import { hash, relative } from "../domain/records.ts";
import type { CodeFile } from "./code.ts";

const invalid = () => {
  throw new PlanError("INVALID", "Invalid versioned language-analysis facts");
};
const list = (v: unknown, max: number): any[] => {
  if (!Array.isArray(v) || v.length > max) return invalid();
  return v;
};
const number = (v: unknown, min: number, max: number) => {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) invalid();
};
function range(v: unknown, lines: number) {
  const r = object(v, ["startLine", "startColumn", "endLine", "endColumn"]);
  number(r.startLine, 1, lines);
  number(r.endLine, Number(r.startLine), lines);
  number(r.startColumn, 0, 512 * 1024);
  number(r.endColumn, 0, 512 * 1024);
  if (r.startLine === r.endLine && Number(r.endColumn) < Number(r.startColumn))
    invalid();
}
function capabilities(v: unknown) {
  const c = object(v, [
    "syntax",
    "scopes",
    "imports",
    "relationships",
    "architecture",
  ]);
  for (const name of [
    "syntax",
    "scopes",
    "imports",
    "relationships",
    "architecture",
  ]) {
    const a = object(c[name], ["status", "basis", "detail"]);
    if (
      !["supported", "partial", "unavailable", "parse-error"].includes(
        String(a.status),
      ) ||
      !["parser", "compiler", "project-resolver"].includes(
        String(a.basis),
      )
    )
      invalid();
    text(a.detail, "capability detail", 2000);
  }
}
export function validateLanguageAnalysis(
  input: unknown,
  file: CodeFile,
  files: CodeFile[],
) {
  const a = object(input, [
    "version",
    "adapter",
    "adapterVersion",
    "tool",
    "toolVersion",
    "source",
    "context",
    "capabilities",
    "scopes",
    "symbols",
    "relationships",
    "gaps",
  ]);
  if (a.version !== 1 || a.source !== file.sha256) invalid();
  for (const field of ["adapter", "adapterVersion", "tool", "toolVersion"])
    text(a[field], field, 200);
  hash(a.source);
  hash(a.context);
  capabilities(a.capabilities);
  const scopes = list(a.scopes, 4000),
    ids = new Set(scopes.map((s) => s.id));
  if (ids.size !== scopes.length) invalid();
  for (const raw of scopes) {
    const s = object(raw, ["id", "name", "kind", "parent", "range"]);
    text(s.id, "scope identity", 800);
    text(s.name, "scope name", 300);
    text(s.kind, "scope kind", 100);
    range(s.range, file.lines);
    if (s.parent !== undefined && (!ids.has(s.parent) || s.parent === s.id))
      invalid();
  }
  const symbols = list(a.symbols, 4000),
    symbolIds = new Set(symbols.map((s) => s.id));
  if (symbolIds.size !== symbols.length) invalid();
  for (const raw of symbols) {
    const s = object(raw, ["id", "name", "kind", "scope", "range"]);
    text(s.id, "symbol identity", 800);
    text(s.name, "symbol name", 300);
    text(s.kind, "symbol kind", 100);
    range(s.range, file.lines);
    if (!ids.has(s.scope)) invalid();
  }
  for (const raw of list(a.relationships, 4000)) {
    const r = object(raw, [
      "kind",
      "spelling",
      "scope",
      "range",
      "resolution",
      "target",
      "reason",
    ]);
    if (
      !["call", "reference", "inherits"].includes(String(r.kind)) ||
      !["resolved", "unresolved"].includes(String(r.resolution)) ||
      !ids.has(r.scope)
    )
      invalid();
    text(r.spelling, "relationship spelling", 160);
    range(r.range, file.lines);
    if (r.reason !== undefined) text(r.reason, "unresolved reason", 2000);
    if ((r.resolution === "resolved") !== !!r.target) invalid();
    if (r.target) {
      const target = object(r.target, ["path", "symbol", "range"]);
      relative(target.path);
      text(target.symbol, "target identity", 800);
      const f = files.find((f) => f.path === target.path),
        symbol = f?.analysis?.symbols.find((s) => s.id === target.symbol);
      if (
        !f ||
        !symbol ||
        JSON.stringify(symbol.range) !== JSON.stringify(target.range)
      )
        invalid();
      range(target.range, f!.lines);
    }
  }
  for (const gap of list(a.gaps, 50)) text(gap, "analysis gap", 3000);
}
export function validateAnalysisReport(input: unknown, files: CodeFile[]) {
  const a = object(input, [
    "version",
    "fingerprint",
    "configuration",
    "adapters",
    "gaps",
    "elapsedMs",
  ]);
  if (a.version !== 1) invalid();
  hash(a.fingerprint);
  number(a.elapsedMs, 0, 60000);
  for (const raw of list(a.configuration, 1500)) {
    const c = object(raw, ["path", "sha256"]);
    relative(c.path);
    if (!["absent", "unavailable"].includes(String(c.sha256))) hash(c.sha256);
  }
  const adapters = list(a.adapters, 100);
  if (new Set(adapters.map((x) => x.id)).size !== adapters.length) invalid();
  for (const raw of adapters) {
    const r = object(raw, [
      "id",
      "version",
      "tool",
      "toolVersion",
      "files",
      "capabilities",
    ]);
    for (const name of ["id", "version", "tool", "toolVersion"])
      text(r[name], name, 200);
    number(r.files, 1, 1500);
    capabilities(r.capabilities);
  }
  for (const f of files)
    if (f.analysis && f.analysis.context !== a.fingerprint) invalid();
  for (const gap of list(a.gaps, 50)) text(gap, "analysis gap", 3000);
}

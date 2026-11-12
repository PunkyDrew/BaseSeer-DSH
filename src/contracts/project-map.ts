import { object, text, revision, PlanError } from "../domain/plan.ts";
import { hash } from "../domain/records.ts";
import {
  validateLanguageAnalysis,
  validateAnalysisReport,
} from "./language-validation.ts";
import type { CodeFile, CodeSnapshot } from "./code.ts";
import {
  connectionClaims,
  type ConnectionCitation,
  type ConnectionClaim,
} from "./source-connections.ts";
// Saved project-map shapes shared by storage, application and the UI.
export interface ScanProgress {
  phase: "reading" | "analyzing";
  visited: number;
  files: number;
  bytes: number;
  path: string;
}
export type ProjectSnapshot = CodeSnapshot & {
  scope: string;
  context: string;
  progress: ScanProgress;
};
export interface SourceExplanation {
  connections?: ConnectionClaim[];
  id: string;
  title: string;
  explanation: string;
  kind: "inferred";
  context: string;
  author: string;
  createdAt: string;
  sources: {
    path: string;
    sha256: string;
    startLine: number;
    endLine: number;
    quote: string;
  }[];
}
export type SavedMap = {
  baseline: ProjectSnapshot | null;
  latest: ProjectSnapshot | null;
  explanations: SourceExplanation[];
};
// Responses the UI reads from the project-map service. The service methods are
// annotated with these types, so the compiler keeps both sides in step.
export type MapChanges = {
  comparable: boolean;
  reason: string;
  added: string[];
  changed: string[];
  unavailable: string[];
  contextChanged: boolean;
};
export type MapStatus = {
  job:
    | {
        id: string;
        status: "running" | "complete" | "cancelled" | "error";
        progress?: ScanProgress;
        error?: string;
      }
    | undefined;
  snapshot: ProjectSnapshot | null;
  baseline: {
    checkedAt: string;
    scope: string;
    partial: boolean;
    files: number;
  } | null;
  changes: MapChanges | null;
  explanations: (SourceExplanation & { stale: boolean })[];
};
export type ScenarioSource = {
  historical: boolean;
  digest: string | undefined;
  sources: SourceExplanation["sources"];
};
export type StatementSupportView = {
  version: 1;
  historical: boolean;
  digest: string | undefined;
  withoutSupport: boolean;
  statements: {
    target: string;
    label: string;
    statement: string;
    anchor: string;
    binding: "not-requested" | "matched-static" | "unresolved" | "contradicted";
    interpretation: "unchecked";
    interpretationGap: string;
    execution: "not-established";
    reason: string;
    analyzer: string | undefined;
    citations: SourceExplanation["sources"];
    gap: boolean;
  }[];
  missing: number;
  anchored: number;
  staticBindings: number;
};
export type ReviewBindingView = {
  current: boolean;
  scope: string;
  subjects: string[];
  reason: string;
};
export type RecordSupport = Record<
  string,
  StatementSupportView | ReviewBindingView
>;
const array = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max)
    throw new PlanError("INVALID", "Invalid bounded project-map list");
  return value;
};
const sourcePath = (value: unknown, allowEmpty = false) => {
  const p = text(value, "project-map path", 400);
  if (
    (!allowEmpty && !p) ||
    /^[\\/]|[\\:\0]/.test(p) ||
    p.split("/").includes("..")
  )
    throw new PlanError("INVALID", "Project-map paths must be relative");
  return p;
};
const boolean = (v: unknown) => {
  if (typeof v !== "boolean")
    throw new PlanError("INVALID", "Invalid project-map flag");
};
function snapshot(input: unknown) {
  if (input === null) return;
  const s = object(input, [
    "digest",
    "context",
    "git",
    "checkedAt",
    "analyzer",
    "files",
    "omissions",
    "partial",
    "limits",
    "scope",
    "progress",
    "analysis",
    "sourceDigest",
  ]);
  hash(s.digest);
  hash(s.context);
  if (s.sourceDigest !== undefined) hash(s.sourceDigest);
  text(s.checkedAt, "scan time", 100);
  text(s.analyzer, "analyzer", 300);
  sourcePath(s.scope, true);
  boolean(s.partial);
  if (s.git) {
    const g = object(s.git, ["head", "branch", "tree"]);
    for (const v of Object.values(g)) text(v, "Git context", 300);
  }
  const names = new Set<string>();
  for (const raw of array(s.files, 1500)) {
    const f = object(raw, [
        "path",
        "sha256",
        "language",
        "lines",
        "bytes",
        "declarations",
        "imports",
        "calls",
        "coverage",
        "analysis",
      ]),
      name = sourcePath(f.path);
    if (names.has(name))
      throw new PlanError("INVALID", "Duplicate source file in project map");
    names.add(name);
    hash(f.sha256);
    text(f.language, "language", 200);
    revision(f.lines);
    revision(f.bytes);
    if (
      Number(f.bytes) > 512 * 1024 ||
      !["syntax", "unsupported", "parse-error"].includes(String(f.coverage))
    )
      throw new PlanError("INVALID", "Invalid source coverage or size");
    for (const raw of array(f.declarations, 50000)) {
      const d = object(raw, ["name", "kind", "line", "endLine"]);
      text(d.name, "declaration", 4000);
      text(d.kind, "kind", 100);
      revision(d.line);
      revision(d.endLine);
    }
    for (const raw of array(f.imports, 50000)) {
      const d = object(raw, [
        "specifier",
        "line",
        "kind",
        "target",
        "resolution",
      ]);
      text(d.specifier, "specifier", 512 * 1024);
      revision(d.line);
      if (d.target !== undefined) sourcePath(d.target);
      if (
        !["value", "type", "dynamic", "require"].includes(String(d.kind)) ||
        !["local", "external", "unresolved"].includes(String(d.resolution))
      )
        throw new PlanError("INVALID", "Invalid import observation");
    }
    for (const raw of array(f.calls ?? [], 50000)) {
      const c = object(raw, ["caller", "callee", "line", "resolution"]);
      text(c.caller, "caller", 4000);
      text(c.callee, "callee", 160);
      revision(c.line);
      if (!["same-file-name", "unresolved"].includes(String(c.resolution)))
        throw new PlanError("INVALID", "Invalid call observation");
    }
  }
  for (const f of s.files as CodeFile[])
    if (f.analysis)
      validateLanguageAnalysis(f.analysis, f, s.files as CodeFile[]);
  if (s.analysis !== undefined)
    validateAnalysisReport(s.analysis, s.files as CodeFile[]);
  for (const raw of array(s.omissions, 20050)) {
    const o = object(raw, ["path", "reason"]);
    sourcePath(o.path);
    text(o.reason, "omission", 1000);
  }
  for (const raw of array(s.limits, 30)) text(raw, "scan limitation", 3000);
  const p = object(s.progress, ["phase", "visited", "files", "bytes", "path"]);
  if (!["reading", "analyzing"].includes(String(p.phase)))
    throw new PlanError("INVALID", "Invalid scan phase");
  revision(p.visited);
  revision(p.files);
  revision(p.bytes);
  sourcePath(p.path);
}
export function validateProjectMap(input: unknown): SavedMap {
  const m = object(input, ["baseline", "latest", "explanations"]);
  snapshot(m.baseline);
  snapshot(m.latest);
  if (!!m.baseline !== !!m.latest)
    throw new PlanError(
      "INVALID",
      "Project map needs both initial and latest source snapshots",
    );
  const ids = new Set<string>();
  for (const raw of array(m.explanations, 80)) {
    const e = object(raw, [
      "id",
      "title",
      "explanation",
      "kind",
      "context",
      "author",
      "createdAt",
      "sources",
      "connections",
    ]);
    const id = text(e.id, "inference identity", 100);
    if (ids.has(id))
      throw new PlanError("INVALID", "Duplicate inference identity");
    ids.add(id);
    if (e.kind !== "inferred")
      throw new PlanError("INVALID", "An explanation is an inference");
    hash(e.context);
    text(e.title, "inference title", 160);
    text(e.explanation, "inference", 4000);
    text(e.author, "author", 200);
    text(e.createdAt, "time", 100);
    const refs = array(e.sources, 8);
    if (!refs.length)
      throw new PlanError("INVALID", "Inference citations are required");
    for (const raw of refs) {
      const r = object(raw, [
        "path",
        "sha256",
        "startLine",
        "endLine",
        "quote",
      ]);
      sourcePath(r.path);
      hash(r.sha256);
      revision(r.startLine);
      revision(r.endLine);
      text(r.quote, "source quote", 4000);
      if (
        Number(r.startLine) < 1 ||
        Number(r.endLine) < Number(r.startLine) ||
        Number(r.endLine) - Number(r.startLine) > 80
      )
        throw new PlanError("INVALID", "Invalid citation range");
    }
    connectionClaims(e.connections, refs as ConnectionCitation[]);
  }
  return input as SavedMap;
}

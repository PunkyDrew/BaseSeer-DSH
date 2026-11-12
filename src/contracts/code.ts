import type { LanguageAnalysis, AnalysisReport } from "./language-analysis.ts";
// Source observations are independent of planning records and never prove behavior.
export interface Declaration {
  name: string;
  kind: string;
  line: number;
  endLine: number;
}
export interface ImportObservation {
  specifier: string;
  line: number;
  kind: "value" | "type" | "dynamic" | "require";
  target?: string;
  resolution: "local" | "external" | "unresolved";
}
export interface CodeFile {
  analysis?: LanguageAnalysis;
  path: string;
  sha256: string;
  language: string;
  lines: number;
  bytes: number;
  declarations: Declaration[];
  imports: ImportObservation[];
  calls?: {
    caller: string;
    callee: string;
    line: number;
    resolution: "same-file-name" | "unresolved";
  }[];
  coverage: "syntax" | "unsupported" | "parse-error";
}
export interface CodeSnapshot {
  analysis?: AnalysisReport;
  sourceDigest?: string;
  digest: string;
  git?: { head: string; branch: string; tree: string } | null;
  checkedAt: string;
  analyzer: string;
  files: CodeFile[];
  omissions: { path: string; reason: string }[];
  partial: boolean;
  limits: string[];
}

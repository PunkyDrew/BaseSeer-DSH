// Versioned, source-bound facts. A resolved reference is not executed behavior.
export type CapabilityStatus =
  | "supported"
  | "partial"
  | "unavailable"
  | "parse-error";
export type Capability = {
  status: CapabilityStatus;
  basis: "parser" | "compiler" | "project-resolver";
  detail: string;
};
export type Capabilities = Record<
  "syntax" | "scopes" | "imports" | "relationships" | "architecture",
  Capability
>;
export type SourceRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
export type LanguageSymbol = {
  id: string;
  name: string;
  kind: string;
  scope: string;
  range: SourceRange;
};
export type LanguageScope = {
  id: string;
  name: string;
  kind: string;
  parent?: string;
  range: SourceRange;
};
export type LanguageRelationship = {
  kind: "call" | "reference" | "inherits";
  spelling: string;
  scope: string;
  range: SourceRange;
  resolution: "resolved" | "unresolved";
  target?: { path: string; symbol: string; range: SourceRange };
  reason?: string;
};
export type LanguageAnalysis = {
  version: 1;
  adapter: string;
  adapterVersion: string;
  tool: string;
  toolVersion: string;
  source: string;
  context: string;
  capabilities: Capabilities;
  scopes: LanguageScope[];
  symbols: LanguageSymbol[];
  relationships: LanguageRelationship[];
  gaps: string[];
};
export type AnalysisReport = {
  version: 1;
  fingerprint: string;
  configuration: { path: string; sha256: string }[];
  adapters: {
    id: string;
    version: string;
    tool: string;
    toolVersion: string;
    files: number;
    capabilities: Capabilities;
  }[];
  gaps: string[];
  elapsedMs: number;
};

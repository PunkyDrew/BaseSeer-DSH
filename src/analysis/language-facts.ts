import type { CodeFile } from "../contracts/code.ts";
import type {
  Capabilities,
  CapabilityStatus,
  LanguageAnalysis,
} from "../contracts/language-analysis.ts";

export function capabilities(
  status: CapabilityStatus,
  detail: string,
): Capabilities {
  return {
    syntax: { status, basis: "parser", detail },
    scopes: { status, basis: "compiler", detail },
    imports: {
      status: status === "supported" ? "partial" : status,
      basis: "project-resolver",
      detail:
        "Inspected project-local modules only; excluded, external and ambiguous targets remain gaps.",
    },
    relationships: {
      status: status === "supported" ? "partial" : status,
      basis: "compiler",
      detail:
        "Static declaration bindings only; no runtime dispatch or execution proof.",
    },
    architecture: {
      status: status === "supported" ? "partial" : status,
      basis: "project-resolver",
      detail:
        "Recorded local module dependencies; unavailable or unresolved imports cannot establish full conformance.",
    },
  };
}
export function emptyAnalysis(
  file: CodeFile,
  adapter: string,
  tool: string,
  toolVersion: string,
  context: string,
  status: CapabilityStatus = "supported",
  detail = "Parsed source; ranges use one-based lines and zero-based UTF-8 byte columns.",
): LanguageAnalysis {
  return {
    version: 1,
    adapter,
    adapterVersion: "1",
    tool,
    toolVersion,
    source: file.sha256,
    context,
    capabilities: capabilities(status, detail),
    scopes: [],
    symbols: [],
    relationships: [],
    gaps: status === "supported" ? [] : [detail],
  };
}

type FrontendOutput = Pick<
  LanguageAnalysis,
  "scopes" | "symbols" | "relationships" | "gaps"
> &
  Pick<CodeFile, "declarations" | "imports"> & {
    parseError?: boolean;
    semanticError?: boolean;
  };

// Index once per frontend response rather than searching it for every file.
// Keep the first duplicate, matching the previous Array.find behavior.
export function* frontendFiles(
  files: CodeFile[],
  outputs?: (FrontendOutput & { path: string })[],
) {
  const byPath = new Map<string, FrontendOutput>();
  for (const output of outputs ?? [])
    if (!byPath.has(output.path)) byPath.set(output.path, output);
  for (const file of files) yield [file, byPath.get(file.path)] as const;
}

// Closed-context frontends share fact handling; adapters own language labels,
// context validation and their precise limitations. Worker validation still
// checks the completed facts before they can be stored.
export function applyFrontendFacts(
  file: CodeFile,
  output: FrontendOutput | undefined,
  adapter: string,
  tool: string,
  version: string,
  context: string,
  detail: string,
  gap: string,
) {
  const status = !output
    ? "unavailable"
    : output.parseError
      ? "parse-error"
      : output.scopes.length
        ? "supported"
        : "unavailable";
  const analysis = (file.analysis = emptyAnalysis(
    file,
    adapter,
    tool,
    version,
    context,
    status,
    detail,
  ));
  file.coverage =
    status === "supported"
      ? "syntax"
      : status === "parse-error"
        ? "parse-error"
        : "unsupported";
  file.declarations = [];
  file.imports = [];
  file.calls = [];
  if (!output) return;
  file.declarations = output.declarations;
  file.imports = output.imports;
  Object.assign(analysis, {
    scopes: output.scopes,
    symbols: output.symbols,
    relationships: output.relationships,
    gaps: output.gaps,
  });
  if (output.semanticError)
    for (const key of ["imports", "relationships", "architecture"] as const)
      analysis.capabilities[key].status = "unavailable";
  analysis.gaps.push(gap);
}

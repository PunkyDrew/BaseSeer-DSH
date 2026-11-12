import { createHash } from "node:crypto";
import { typescriptAdapter } from "./typescript-language.ts";
import {
  analysisLimits,
  analysisVersion,
  type AnalysisInput,
  type AnalysisOutput,
} from "./language-types.ts";
import { emptyAnalysis } from "./language-facts.ts";
import { webAdapter } from "./web-language.ts";
import { packageJsonAdapter } from "./package-json-language.ts";

// Only analyzers that need no tool installed beside BaseSeer: files in other
// languages are read as source, which is all coverage and the plan's file map
// need.
export const languageAdapters = [packageJsonAdapter, webAdapter, typescriptAdapter];
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function analyzeLanguages(input: AnalysisInput): AnalysisOutput {
  const started = Date.now();
  const configuration = [
    ...new Map(
      [
        ...(input.configuration ?? []),
        ...input.files
          .filter((f) =>
            /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|package\.json)$/.test(
              f.path,
            ),
          )
          .map((f) => ({ path: f.path, sha256: f.sha256 })),
      ].map((c) => [c.path, c]),
    ).values(),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const context = hash({
    version: analysisVersion,
    files: input.files.map((f) => [f.path, f.sha256]),
    configuration,
  });
  let facts = 0;
  for (const adapter of languageAdapters) {
    const selected = input.files.filter((f) => adapter.accepts(f.path));
    let bytes = 0;
    const admitted = selected.filter((f) => {
      if (bytes + f.bytes > analysisLimits.adapterBytes) {
        f.analysis = emptyAnalysis(
          f,
          adapter.id,
          adapter.id,
          "not-run",
          context,
          "unavailable",
          "Adapter input exceeds 8 MiB; narrow the scan folder.",
        );
        return false;
      }
      bytes += f.bytes;
      return true;
    });
    if (admitted.length)
      adapter.analyze(admitted, context, {
        ...input,
        configuration,
        paths: input.files.map((f) => f.path),
      });
    for (const f of admitted) {
      const a = f.analysis!;
      facts +=
        a.symbols.length +
        a.scopes.length +
        a.relationships.length +
        f.imports.length;
      if (facts > analysisLimits.totalFacts) {
        f.analysis = emptyAnalysis(
          f,
          adapter.id,
          a.tool,
          a.toolVersion,
          context,
          "unavailable",
          "Analysis reached 60,000 facts; narrow the scan folder.",
        );
        f.coverage = "unsupported";
        f.declarations = [];
        f.imports = [];
        f.calls = [];
      }
    }
  }
  // A bounded or failed target must never leave a seemingly resolved symbol.
  const symbols = new Map(
    input.files.map((f) => [
      f.path,
      new Set(f.analysis?.symbols.map((s) => s.id) ?? []),
    ]),
  );
  for (const f of input.files)
    for (const rel of f.analysis?.relationships ?? []) {
      if (rel.target && !symbols.get(rel.target.path)?.has(rel.target.symbol)) {
        delete rel.target;
        rel.resolution = "unresolved";
        rel.reason =
          "Target facts are unavailable or outside the bounded scan.";
      }
    }
  const adapters = languageAdapters.flatMap((adapter) => {
    const files = input.files.filter((f) => f.analysis?.adapter === adapter.id);
    if (!files.length) return [];
    const a = (
      files.find((f) => f.analysis!.toolVersion !== "not-run") ?? files[0]
    ).analysis!;
    const capabilities = structuredClone(a.capabilities);
    for (const name of Object.keys(
      capabilities,
    ) as (keyof typeof capabilities)[]) {
      const statuses = files.map((f) => f.analysis!.capabilities[name].status);
      capabilities[name].status = statuses.every((s) => s === "unavailable")
        ? "unavailable"
        : statuses.every((s) => s === "parse-error")
          ? "parse-error"
          : statuses.every((s) => s === "supported")
            ? "supported"
            : "partial";
    }
    return [
      {
        id: adapter.id,
        version: adapter.version,
        tool: a.tool,
        toolVersion: a.toolVersion,
        files: files.length,
        capabilities,
      },
    ];
  });
  const gaps: string[] = [];
  if (configuration.some((c) => c.sha256 === "unavailable"))
    gaps.push(
      "Some project configuration is unavailable or excluded; project-context coverage is incomplete. Configuration scripts are never executed.",
    );
  if (adapters.length > 1)
    gaps.push(
      "Mixed-language inventory: no cross-language interface is established. A checked contract, registration or generated binding is required; matching names and nearby files are not evidence.",
    );
  if (input.files.some((f) => !f.analysis))
    gaps.push(
      "Files without an available language adapter retain source-reading-only coverage.",
    );
  const fingerprint = hash({ version: analysisVersion, context, adapters });
  for (const f of input.files) if (f.analysis) f.analysis.context = fingerprint;
  return {
    files: input.files.map(({ content: _content, ...file }) => file),
    analysis: {
      version: 1,
      fingerprint,
      configuration,
      adapters,
      gaps,
      elapsedMs: Date.now() - started,
    },
  };
}

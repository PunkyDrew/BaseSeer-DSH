import { PlanError, text } from "../domain/plan.ts";
import { inventory, sha256 } from "./code-inventory.ts";
import { analyze, analyzeSync } from "./language-runner.ts";
import { analysisVersion } from "./language-types.ts";
import { configurationContext, configurationCurrent } from "./project-scan.ts";
import type { CodeSnapshot } from "../contracts/code.ts";
import { gitContext, gitContextAsync } from "./git-context.ts";

export function inspectCode(root: string): CodeSnapshot {
  return inspectInventory(root, inventory(root));
}
function analysisInput(source: ReturnType<typeof inventory>) {
  return source.files.map((f) => ({
    ...f,
    lines: f.content.split(/\r?\n/).length,
    declarations: [],
    imports: [],
    coverage: "unsupported" as const,
  }));
}
function inspectInventory(
  root: string,
  source: ReturnType<typeof inventory>,
): CodeSnapshot {
  const configuration = configurationContext(root);
  return inspected(
    root,
    source,
    configuration,
    analyzeSync({ files: analysisInput(source), configuration }),
    gitContext(root),
  );
}
export async function inspectCodeAsync(
  root: string,
  signal?: AbortSignal,
): Promise<CodeSnapshot> {
  signal?.throwIfAborted();
  const source = inventory(root),
    configuration = configurationContext(root);
  const result = await analyze(
    { files: analysisInput(source), configuration },
    { signal },
  );
  const git = await gitContextAsync(root, signal);
  signal?.throwIfAborted();
  return inspected(root, source, configuration, result, git);
}
function inspected(
  root: string,
  source: ReturnType<typeof inventory>,
  configuration: ReturnType<typeof configurationContext>,
  { files, analysis }: ReturnType<typeof analyzeSync>,
  git: ReturnType<typeof gitContext>,
): CodeSnapshot {
  if (!configurationCurrent(root, configuration))
    throw new PlanError(
      "STALE",
      "Project configuration changed during analysis; refresh code.",
    );
  if (inventory(root).digest !== source.digest)
    throw new PlanError(
      "STALE",
      "Source changed during analysis; refresh code.",
    );
  return {
    sourceDigest: source.digest,
    digest: sha256(source.digest + analysis.fingerprint),
    git,
    checkedAt: new Date().toISOString(),
    analyzer: analysisVersion,
    analysis,
    files,
    omissions: source.omissions,
    partial: source.partial,
    limits: [
      "No type checking result or runtime verification is claimed. Compiler bindings establish inspected declaration references only.",
      "Observed local working files, including unplanned and uncommitted files. Git context is reported when available; file content is not assumed equal to that commit. Branch/HEAD changes invalidate saved evidence context even when file bytes match.",
      "Each file reports the frontend, tool version and capabilities actually used. Static declaration bindings do not prove runtime calls. Unsupported modules, external dependencies, custom loaders and dynamic dispatch remain explicit gaps.",
      "Each analysis worker is bounded to 25 seconds, 256 MiB Node heap, 8 MiB per adapter and 60,000 facts. Project code, macros, plugins, processors and configuration scripts never execute.",
      "Files without an available adapter remain readable without an analysis pass. Hidden/private paths, dependency/build folders and suspicious content are excluded. Git ignore rules are not evaluated; exclusion is not a guarantee of absence of secrets.",
      "At most 64 KiB per file, 8 MiB total, 2000 entries and 12 directory levels. Review saves observations and checks explicit module contracts; Code alone does not mark design implemented.",
    ],
  };
}
export async function codeContentAsync(
  root: string,
  digest: unknown,
  name: unknown,
) {
  const observed = await inspectCodeAsync(root);
  const source = inventory(root);
  if (
    observed.digest !== text(digest, "source digest", 64) ||
    source.digest !== observed.sourceDigest
  )
    throw new PlanError(
      "STALE",
      "Source changed. Refresh Code before opening this location.",
    );
  const file = source.files.find(
    (f) => f.path === text(name, "source path", 200),
  );
  if (!file)
    throw new PlanError(
      "DENIED",
      "This file is not in the inspected safe source inventory.",
    );
  return { path: file.path, sha256: file.sha256, content: file.content };
}

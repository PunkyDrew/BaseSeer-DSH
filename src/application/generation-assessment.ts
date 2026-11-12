import type {
  CandidateOperation,
  GenerationAssessment,
} from "../contracts/generation.ts";
import { isOperationCandidate } from "../analysis/operation-candidates.ts";
import { componentMap } from "../contracts/component-map.ts";
import { createHash } from "node:crypto";
import type { ProjectSnapshot } from "../contracts/project-map.ts";
import type { SourceExplanation } from "../contracts/project-map.ts";
import type { Document, PlanningRecord } from "../domain/records.ts";
import { canonical, hash, id, relative } from "../domain/records.ts";
import { object, text, revision, PlanError } from "../domain/plan.ts";
import { statementSupport, reviewBinding } from "./statement-support.ts";

export const assessmentLimits = { operations: 120, selected: 24, areas: 60 };
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export type GenerationCounts = {
  files: number;
  partial: boolean;
  explanations: number;
  connections: number;
  components: number;
  relationships: number;
  scenarios: number;
  reviewItems: number;
  followUps: number;
  missing: string[];
};
const usable = (r: PlanningRecord) => ["draft", "accepted"].includes(r.status);

// This is a known set of syntax candidates, never an inventory of runtime behavior.
function candidateInventory(snapshot: ProjectSnapshot) {
  let total = 0;
  const queues = snapshot.files
    .filter((f) => f.coverage === "syntax")
    .map((f) => {
      const declarations = f.declarations.filter((d) =>
        isOperationCandidate(f, d),
      );
      total += declarations.length;
      return declarations
        .slice(0, assessmentLimits.operations)
        .map((d, index) => ({
          id: digest([
            f.path,
            f.sha256,
            d.line,
            d.endLine,
            d.kind,
          ]),
          name: d.name.slice(0, 300),
          path: f.path,
          sha256: f.sha256,
          startLine: d.line,
          endLine: d.endLine,
          origin: "source-declaration" as const,
          selected: false,
          reason:
            "Deferred after the bounded representative selection; still a known omission.",
          scenarios: [] as string[],
        }));
    });
  const output: CandidateOperation[] = [];
  // Round robin prevents one large file from consuming the whole selection.
  for (
    let n = 0;
    queues.some((q) => n < q.length) &&
    output.length < assessmentLimits.operations;
    n++
  )
    for (const q of queues)
      if (q[n] && output.length < assessmentLimits.operations)
        output.push({
          ...q[n],
          selected: output.length < assessmentLimits.selected,
          reason:
            output.length < assessmentLimits.selected
              ? "Selected in source-file order, one declaration per file per pass, to spread inspection across the scope."
              : q[n].reason,
        });
  return { operations: output, total };
}
export function generationCandidates(
  snapshot: ProjectSnapshot,
): CandidateOperation[] {
  return candidateInventory(snapshot).operations;
}

function reachable(r: PlanningRecord, components: Set<string>) {
  const flow = r.data.flow;
  if (
    !flow?.nodes?.length ||
    !flow.transitions?.length ||
    flow.nodes.length < 2 ||
    !flow.nodes.every((n: any) => components.has(n.component))
  )
    return false;
  const reached = new Set([flow.entry]);
  for (let i = 0; i < flow.nodes.length; i++)
    for (const t of flow.transitions)
      if (reached.has(t.from)) reached.add(t.to);
  return (
    flow.nodes.every((n: any) => reached.has(n.id)) &&
    flow.nodes.some((n: any) => n.terminal && n.id !== flow.entry)
  );
}

export function assessGeneration(input: {
  run: string;
  snapshot: ProjectSnapshot;
  explanations: SourceExplanation[];
  document: Document;
  revision: number;
}): { assessment: GenerationAssessment; result: GenerationCounts } {
  const { snapshot: s, document: doc } = input;
  const files = new Map(s.files.map((f) => [f.path, f]));
  const explanations = input.explanations.filter(
    (e) =>
      e.context === s.context &&
      e.sources.length &&
      e.sources.every(
        (c) =>
          files.get(c.path)?.sha256 === c.sha256 &&
          c.startLine >= 1 &&
          c.endLine <= files.get(c.path)!.lines,
      ),
  );
  const byExplanation = new Map(explanations.map((e) => [e.id, e]));
  const bound = (r: PlanningRecord) =>
    usable(r) &&
    r.data.source &&
    r.data.source.context === s.context &&
    byExplanation.has(r.data.source.explanation);
  const components = doc.records.filter(
    (r) => r.kind === "component" && bound(r),
  );
  const componentIds = new Set(components.map((r) => r.id));
  const map = {
    latest: s,
    baseline: null,
    explanations: input.explanations,
  };
  const scenarios = doc.records.filter(
    (r) => r.kind === "scenario" && bound(r) && reachable(r, componentIds),
  );
  const findings = doc.records.filter(
    (r) =>
      r.kind === "finding" &&
      bound(r) &&
      r.data.coverage &&
      reviewBinding(r, doc.records, map).current,
  );
  const claims = doc.records.filter(
    (r) =>
      r.kind === "claim" &&
      bound(r) &&
      r.data.origin === "agent-inference" &&
      r.data.assessment === "unchecked" &&
      reviewBinding(r, doc.records, map).current &&
      [...components, ...scenarios].some(
        (subject) => subject.id === r.data.subject,
      ),
  );
  const followUps = doc.records.filter(
    (r) =>
      r.kind === "task" &&
      r.status === "draft" &&
      r.data.state === "planned" &&
      r.data.checks.length &&
      doc.links.some(
        (l) =>
          l.kind === "addresses" &&
          l.from === r.id &&
          findings.some((f) => f.id === l.to),
      ),
  );
  const relevant = [
    ...components,
    ...scenarios,
    ...findings,
    ...claims,
    ...followUps,
  ];
  const ids = new Set(relevant.map((r) => r.id));
  const links = doc.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  const inventory = candidateInventory(s),
    allCandidates = inventory.operations;
  const operations = allCandidates
    .slice(0, assessmentLimits.operations)
    .map((c) => ({
      ...c,
      scenarios: scenarios
        .filter(
          (r) =>
            r.data.source.operation?.path === c.path &&
            r.data.source.operation?.line === c.startLine &&
            byExplanation
              .get(r.data.source.explanation)!
              .sources.some(
                (ref) =>
                  ref.path === c.path &&
                  ref.sha256 === c.sha256 &&
                  ref.startLine <= c.startLine &&
                  ref.endLine >= c.startLine,
              ),
        )
        .map((r) => r.id),
    }));
  const explained = new Set(
    explanations.flatMap((e) => e.sources.map((c) => c.path)),
  );
  const componentFiles = new Set(
    components.flatMap((r) =>
      (r.data.observed?.paths ?? []).filter((p: string) =>
        byExplanation
          .get(r.data.source.explanation)!
          .sources.some((c) => c.path === p),
      ),
    ),
  );
  const groups = new Map<string, GenerationAssessment["areas"][number]>();
  for (const f of s.files) {
    const rel = s.scope ? f.path.slice(s.scope.length + 1) : f.path;
    const area = rel.includes("/")
      ? [s.scope, rel.split("/")[0]].filter(Boolean).join("/")
      : s.scope || ".";
    const g = groups.get(area) ?? {
      path: area,
      files: 0,
      explainedFiles: 0,
      componentFiles: 0,
    };
    g.files++;
    if (explained.has(f.path)) g.explainedFiles++;
    if (componentFiles.has(f.path)) g.componentFiles++;
    groups.set(area, g);
  }
  const gaps: GenerationAssessment["gaps"] = [];
  const gap = (
    kind: string,
    view: GenerationAssessment["gaps"][number]["view"],
    message: string,
  ) => gaps.push({ kind, view, message });
  const architecture = componentMap(doc, s, input.explanations);
  if (architecture.unassigned.length)
    gap(
      "unmapped-components",
      "Code",
      `${architecture.unassigned.length} inspected files have no explicit source-bound component responsibility. Map their responsibilities or retain the coverage gap; folder and file names are not architectural evidence.`,
    );
  if (architecture.ambiguous.length)
    gap(
      "ambiguous-components",
      "Code",
      `${architecture.ambiguous.length} files belong to multiple components. Their references cannot be assigned uniquely to a responsibility.`,
    );
  const unexplained = architecture.relationships.filter(
    (r) => !r.purposes.length,
  );
  const incompleteComponents = architecture.components.filter(
    (c) => c.paths.length && c.gaps.length,
  );
  if (incompleteComponents.length)
    gap(
      "component-description",
      "Code",
      `${incompleteComponents.length} source-bound components have incomplete responsibility, input/output or source mappings. Read their component gaps; a mapped file alone does not explain its role.`,
    );
  if (unexplained.length)
    gap(
      "unexplained-dependencies",
      "Code",
      `${unexplained.length} directed component dependencies have static references but no cited purpose. Inspect both endpoints and explain the call, data or interface exchanged; generic uses links do not explain these dependencies.`,
    );
  const support = [...components, ...scenarios].map((r) =>
    statementSupport(r, map),
  );
  const statements = {
    version: 1 as const,
    total: support.reduce((n, s) => n + s.statements.length, 0),
    anchored: support.reduce((n, s) => n + s.anchored, 0),
    staticBindings: support.reduce((n, s) => n + s.staticBindings, 0),
    gaps: support.reduce((n, s) => n + s.missing, 0),
    unchecked: support.reduce((n, s) => n + s.statements.length, 0),
  };
  if (statements.gaps)
    gap(
      "statement-support",
      "Behavior",
      `${statements.gaps} material statements have missing, historical or explicitly unresolved support. Open their evidence details; record counts do not close these gaps.`,
    );
  if (components.some((r) => !r.data.observed?.paths.length))
    gap(
      "component-mapping",
      "Planning",
      "Some source-inferred components lack explicit observed source mappings and input/output boundaries.",
    );
  if (components.some((r) => !r.data.contract))
    gap(
      "intended-contract",
      "Review",
      "Intended boundary comparison is unavailable for components without a contract. Observed dependencies do not become allowed dependencies; retain proposed responsibilities for later design.",
    );
  if (s.scope)
    gap(
      "outside-scope",
      "Code",
      "Folders outside the selected scope were not assessed.",
    );
  if (s.partial)
    gap(
      "partial-scan",
      "Code",
      "The scan stopped short of the selected folder's readable inventory. Inspect scan exclusions or choose a smaller folder.",
    );
  const unsupported = s.files.filter(
    (f) => f.coverage === "unsupported",
  ).length;
  const parseErrors = s.files.filter(
    (f) => f.coverage === "parse-error",
  ).length;
  const unresolvedImports = s.files.reduce(
    (n, f) => n + f.imports.filter((i) => i.resolution === "unresolved").length,
    0,
  );
  if (unsupported)
    gap(
      "unsupported",
      "Code",
      `${unsupported} files have source-reading support only; operation discovery is unavailable for them.`,
    );
  if (parseErrors)
    gap(
      "parse-error",
      "Code",
      `${parseErrors} files could not be parsed reliably.`,
    );
  if (unresolvedImports)
    gap(
      "unresolved-import",
      "Code",
      `${unresolvedImports} imports remain unresolved, including possible dependencies outside this folder.`,
    );
  for (const message of s.analysis?.gaps ?? [])
    gap("language-analysis", "Code", message);
  const unavailableAnalyzers = s.files.filter(
    (f) => f.analysis?.capabilities.syntax.status === "unavailable",
  ).length;
  if (unavailableAnalyzers)
    gap(
      "analyzer-unavailable",
      "Code",
      `${unavailableAnalyzers} source files lack available analyzer results. Check tool setup, time/resource limits and refresh code.`,
    );
  const unresolvedRelationships = s.files.reduce(
    (n, f) =>
      n +
      (f.analysis?.relationships.filter((r) => r.resolution === "unresolved")
        .length ?? 0),
    0,
  );
  if (unresolvedRelationships)
    gap(
      "unresolved-relationships",
      "Code",
      `${unresolvedRelationships} static relationship targets remain unresolved; source-reading or model interpretation cannot replace these missing bindings.`,
    );
  if (explained.size < s.files.length)
    gap(
      "unexplained-source",
      "Code",
      `${s.files.length - explained.size} inspected files have no current explanation.`,
    );
  if (componentFiles.size < s.files.length)
    gap(
      "unrepresented-source",
      "Planning",
      `${s.files.length - componentFiles.size} inspected files have no source-bound component.`,
    );
  const adjacency = new Map(components.map((r) => [r.id, [] as string[]]));
  for (const l of links)
    if (
      ["uses", "implements"].includes(l.kind) &&
      componentIds.has(l.from) &&
      componentIds.has(l.to)
    ) {
      adjacency.get(l.from)!.push(l.to);
      adjacency.get(l.to)!.push(l.from);
    }
  const visited = new Set<string>();
  let componentGroups = 0;
  for (const r of components)
    if (!visited.has(r.id)) {
      componentGroups++;
      const queue = [r.id];
      visited.add(r.id);
      for (let i = 0; i < queue.length; i++)
        for (const next of adjacency.get(queue[i])!)
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
    }
  if (componentGroups > 1)
    gap(
      "disconnected-components",
      "Planning",
      `The represented components form ${componentGroups} disconnected groups. Explain their boundaries or add source-supported relationships where they exist.`,
    );
  const missingConnections =
    s.files.some((f) => f.imports.some((i) => i.resolution === "local")) &&
    !explanations.some((e) => e.connections?.length);
  if (missingConnections)
    gap(
      "missing-connections",
      "Code",
      "Local imports were observed, but no current source-cited connections explain their calls or data exchange.",
    );
  const missingOperations = operations.filter((c) => !c.scenarios.length);
  if (missingOperations.length)
    gap(
      "missing-operation",
      "Behavior",
      `${missingOperations.length} known operation candidates have no current source-bound behavior flow. Inspect the operation list to choose what to explain next.`,
    );
  const deferredOperations = Math.max(0, inventory.total - operations.length);
  if (deferredOperations)
    gap(
      "candidate-limit",
      "Behavior",
      `${deferredOperations} further declaration candidates exceed the retained list limit. Narrow the folder to inspect them.`,
    );
  if (!allCandidates.length)
    gap(
      "unknown-operations",
      "Behavior",
      "No operation denominator is available from supported declarations. This does not mean the project has no behavior.",
    );
  const missing: string[] = [];
  if (!explanations.length || missingConnections)
    missing.push("Code citations and connections");
  if (!components.length || componentGroups > 1)
    missing.push("Planning components and relationships");
  if (!scenarios.length)
    missing.push("Behavior flows with current source citations");
  if (!findings.length) missing.push("Review findings and coverage limits");
  if (!claims.length)
    missing.push("Review unchecked claims with current source citations");
  if (!followUps.length) missing.push("Work suggestions linked to findings");
  for (const message of missing)
    gap(
      "missing-records",
      message.startsWith("Code")
        ? "Code"
        : message.startsWith("Planning")
          ? "Planning"
          : message.startsWith("Behavior")
            ? "Behavior"
            : message.startsWith("Work")
              ? "Work"
              : "Review",
      message,
    );
  const assessment: GenerationAssessment = {
    version: 1,
    run: input.run,
    scope: s.scope,
    context: s.context,
    scanDigest: s.digest,
    assessedAt: new Date().toISOString(),
    recordRevision: input.revision,
    documentHash: digest(doc),
    explanationHash: digest(input.explanations),
    state: !allCandidates.length
      ? "unassessed"
      : gaps.some((g) => g.kind !== "outside-scope")
        ? "partial"
        : "representative",
    scan: {
      files: s.files.length,
      partial: s.partial,
      unsupported,
      parseErrors,
      unresolvedImports,
      exclusions: s.omissions.length,
    },
    areas: [...groups.values()].slice(0, assessmentLimits.areas),
    deferredAreas: Math.max(0, groups.size - assessmentLimits.areas),
    operations,
    deferredOperations,
    selection:
      "Known candidates come from parsed TS/JS top-level functions, classes and variables with observed calls. The first 24 are selected round robin across files; at most 120 are retained. This heuristic misses unsupported methods, callbacks and dynamic behavior. Static bindings inform inspection, not runtime proof. Selection is representative, not a claim of importance or exhaustiveness.",
    wholeProgramCoverage: "unknown",
    records: relevant.map((r) => ({
      id: r.id,
      version: r.version,
      hash: digest(r),
    })),
    explanations: explanations.map((e) => ({ id: e.id, hash: digest(e) })),
    evidence: {
      statements,
      status: "source-inferred-unverified",
      uncheckedClaims: claims.length,
      independentVerification: "not-assessed",
    },
    gaps,
  };
  validateGenerationAssessment(assessment);
  return {
    assessment,
    result: {
      files: s.files.length,
      partial: s.partial,
      explanations: explanations.length,
      connections: explanations.reduce(
        (n, e) => n + (e.connections?.length ?? 0),
        0,
      ),
      components: components.length,
      relationships: links.length,
      scenarios: scenarios.length,
      reviewItems: findings.length,
      followUps: followUps.length,
      missing,
    },
  };
}

export function assessmentMatches(
  a: GenerationAssessment,
  snapshot: ProjectSnapshot | null,
  document: Document,
  explanations: SourceExplanation[],
) {
  return (
    snapshot?.scope === a.scope &&
    snapshot.context === a.context &&
    snapshot.digest === a.scanDigest &&
    digest(document) === a.documentHash &&
    digest(explanations) === a.explanationHash
  );
}

// Bounded contract for what the project's local files hold. Unknown versions fail closed.
export function validateGenerationAssessment(
  value: unknown,
): GenerationAssessment {
  const a = object(value, [
    "version",
    "run",
    "scope",
    "context",
    "scanDigest",
    "assessedAt",
    "recordRevision",
    "documentHash",
    "explanationHash",
    "state",
    "scan",
    "areas",
    "deferredAreas",
    "operations",
    "deferredOperations",
    "selection",
    "wholeProgramCoverage",
    "records",
    "explanations",
    "evidence",
    "gaps",
  ]);
  const bad = () => {
    throw new PlanError("INVALID", "Invalid generation assessment");
  };
  const arr = (v: unknown, max: number) => {
    if (!Array.isArray(v) || v.length > max) return bad();
    return v;
  };
  const flag = (v: unknown) => {
    if (typeof v !== "boolean") bad();
  };
  const count = (v: unknown) => {
    const n = revision(v);
    if (n > 100000000) bad();
    return n;
  };
  if (
    a.version !== 1 ||
    a.wholeProgramCoverage !== "unknown" ||
    !["representative", "partial", "unassessed"].includes(String(a.state))
  )
    bad();
  id(a.run);
  if (a.scope) relative(a.scope);
  else if (a.scope !== "") bad();
  for (const key of [
    "context",
    "scanDigest",
    "documentHash",
    "explanationHash",
  ])
    hash(a[key]);
  if (!Number.isFinite(Date.parse(text(a.assessedAt, "assessment time", 100))))
    bad();
  count(a.recordRevision);
  count(a.deferredAreas);
  count(a.deferredOperations);
  text(a.selection, "candidate selection", 2000);
  const s = object(a.scan, [
    "files",
    "partial",
    "unsupported",
    "parseErrors",
    "unresolvedImports",
    "exclusions",
  ]);
  flag(s.partial);
  for (const key of [
    "files",
    "unsupported",
    "parseErrors",
    "unresolvedImports",
    "exclusions",
  ])
    count(s[key]);
  for (const raw of arr(a.areas, assessmentLimits.areas)) {
    const g = object(raw, [
      "path",
      "files",
      "explainedFiles",
      "componentFiles",
    ]);
    if (g.path !== ".") relative(g.path);
    count(g.files);
    if (
      count(g.explainedFiles) > Number(g.files) ||
      count(g.componentFiles) > Number(g.files)
    )
      bad();
  }
  const seen = new Set<string>();
  let selected = 0;
  for (const raw of arr(a.operations, assessmentLimits.operations)) {
    const c = object(raw, [
      "id",
      "name",
      "path",
      "sha256",
      "startLine",
      "endLine",
      "origin",
      "selected",
      "reason",
      "scenarios",
    ]);
    hash(c.id);
    if (seen.has(String(c.id))) bad();
    seen.add(String(c.id));
    text(c.name, "candidate", 300);
    relative(c.path);
    hash(c.sha256);
    if (!count(c.startLine) || count(c.endLine) < Number(c.startLine)) bad();
    flag(c.selected);
    if (c.selected) selected++;
    if (c.origin !== "source-declaration") bad();
    text(c.reason, "selection reason", 1000);
    arr(c.scenarios, 10000).forEach(id);
  }
  if (selected > assessmentLimits.selected) bad();
  for (const raw of arr(a.records, 10000)) {
    const r = object(raw, ["id", "version", "hash"]);
    id(r.id);
    if (!count(r.version)) bad();
    hash(r.hash);
  }
  for (const raw of arr(a.explanations, 80)) {
    const e = object(raw, ["id", "hash"]);
    id(e.id);
    hash(e.hash);
  }
  const e = object(a.evidence, [
    "statements",
    "status",
    "uncheckedClaims",
    "independentVerification",
  ]);
  count(e.uncheckedClaims);
  if (e.statements !== undefined) {
    const s = object(e.statements, [
      "version",
      "total",
      "anchored",
      "staticBindings",
      "gaps",
      "unchecked",
    ]);
    if (s.version !== 1) bad();
    const total = count(s.total);
    for (const key of ["anchored", "staticBindings", "gaps", "unchecked"])
      if (count(s[key]) > total) bad();
    if (Number(s.staticBindings) > Number(s.anchored) || s.unchecked !== total)
      bad();
  }
  if (
    e.status !== "source-inferred-unverified" ||
    e.independentVerification !== "not-assessed"
  )
    bad();
  for (const raw of arr(a.gaps, 40)) {
    const g = object(raw, ["kind", "view", "message"]);
    text(g.kind, "gap kind", 100);
    text(g.message, "gap", 2000);
    if (
      !["Code", "Planning", "Behavior", "Review", "Work"].includes(
        String(g.view),
      )
    )
      bad();
  }
  if (JSON.stringify(a).length > 4 * 1024 * 1024) bad();
  return a as GenerationAssessment;
}

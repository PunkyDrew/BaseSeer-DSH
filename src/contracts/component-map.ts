import type { Document, PlanningRecord } from "../domain/records.ts";
import type { CodeSnapshot } from "./code.ts";
import {
  sourceConnections,
  type ConnectionCitation,
  type ConnectionExplanation,
  type SourceConnection,
} from "./source-connections.ts";

export type MappedComponent = {
  id: string;
  title: string;
  responsibility: string;
  basis: "source-inferred" | "historical" | "unmapped";
  paths: string[];
  proposedPaths: string[];
  inputs: string[];
  outputs: string[];
  state: string[];
  citations: ConnectionCitation[];
  gaps: string[];
};
export type ComponentRelationship = {
  id: string;
  from: string;
  to: string;
  purposes: SourceConnection[];
  references: SourceConnection[];
};
export type ComponentMap = ReturnType<typeof componentMap>;

function validCitation(c: ConnectionCitation, files: CodeSnapshot["files"]) {
  const file = files.find((f) => f.path === c.path);
  return (
    !!file &&
    file.sha256 === c.sha256 &&
    Number.isInteger(c.startLine) &&
    Number.isInteger(c.endLine) &&
    c.startLine >= 1 &&
    c.endLine >= c.startLine &&
    c.endLine <= file.lines
  );
}

// A component is an explicit responsibility, never a guessed folder or the file
// with the most references. This read-only projection is shared by UI and tools.
// A match means bound to this saved inspection, not current disk or proven meaning.
export function componentMap(
  document: Document,
  snapshot: CodeSnapshot & { context?: string },
  explanations: ConnectionExplanation[],
) {
  const components: MappedComponent[] = document.records
    .filter((r) => r.kind === "component" && r.status !== "superseded")
    .map((r: PlanningRecord) => {
      const ref = r.data.source;
      const explanation = explanations.find(
        (e) => e.id === ref?.explanation && e.context === ref?.context,
      );
      const current =
        !!explanation &&
        !!snapshot.context &&
        explanation.context === snapshot.context;
      const citations = explanation?.sources ?? [];
      const proposedPaths: string[] = [
        ...new Set<string>(r.data.observed?.paths ?? []),
      ];
      const paths = proposedPaths.filter(
        (path) =>
          current &&
          citations.some(
            (c) => c.path === path && validCitation(c, snapshot.files),
          ),
      );
      const gaps: string[] = [];
      if (!r.data.responsibility?.trim())
        gaps.push("Responsibility is not recorded.");
      if (!proposedPaths.length)
        gaps.push(
          "No explicit observed source mapping. Intended contracts and prose citations do not assign source ownership.",
        );
      if (proposedPaths.length > paths.length)
        gaps.push(
          "Some mapped paths lack source citations matching this inspection.",
        );
      if (!r.data.observed?.inputs?.length)
        gaps.push("Inputs are not described.");
      if (!r.data.observed?.outputs?.length)
        gaps.push("Outputs are not described.");
      return {
        id: r.id,
        title: r.title,
        responsibility: r.data.responsibility ?? "",
        basis: paths.length
          ? "source-inferred"
          : ref
            ? "historical"
            : "unmapped",
        paths,
        proposedPaths,
        inputs: r.data.observed?.inputs ?? [],
        outputs: r.data.observed?.outputs ?? [],
        state: r.data.observed?.state ?? [],
        citations,
        gaps,
      };
    });
  const owners = new Map<string, string[]>();
  for (const component of components)
    for (const path of component.paths)
      owners.set(path, [...(owners.get(path) ?? []), component.id]);
  const unassigned = snapshot.files
    .filter((f) => !owners.has(f.path))
    .map((f) => f.path);
  const ambiguous = [...owners]
    .filter(([, ids]) => ids.length > 1)
    .map(([path, components]) => ({ path, components }));
  const relationships = new Map<string, ComponentRelationship>();
  const internal: { component: string; connection: SourceConnection }[] = [];
  const unplaced: { connection: SourceConnection; reason: string }[] = [];
  const historical: SourceConnection[] = [];
  for (const connection of sourceConnections(snapshot, explanations)) {
    if (
      connection.stale ||
      !connection.citations.every((c) => validCitation(c, snapshot.files))
    ) {
      historical.push(connection);
      continue;
    }
    const from = owners.get(connection.from) ?? [],
      to = owners.get(connection.to) ?? [];
    if (from.length !== 1 || to.length !== 1) {
      unplaced.push({
        connection,
        reason:
          from.length > 1 || to.length > 1
            ? "A file belongs to multiple components; the relationship cannot be assigned uniquely."
            : "One or both files have no source-bound component.",
      });
      continue;
    }
    if (from[0] === to[0]) {
      internal.push({ component: from[0], connection });
      continue;
    }
    const id = JSON.stringify([from[0], to[0]]);
    const relation = relationships.get(id) ?? {
      id,
      from: from[0],
      to: to[0],
      purposes: [],
      references: [],
    };
    (connection.basis === "inferred"
      ? relation.purposes
      : relation.references
    ).push(connection);
    relationships.set(id, relation);
  }
  const unresolved = snapshot.files.flatMap((f) =>
    f.imports
      .filter(
        (i) =>
          !i.target || !snapshot.files.some((other) => other.path === i.target),
      )
      .map((i) => ({
        path: f.path,
        line: i.line,
        specifier: i.specifier,
        resolution: i.resolution,
      })),
  );
  return {
    digest: snapshot.digest,
    inspectedPaths: snapshot.files.map((f) => f.path),
    components,
    relationships: [...relationships.values()],
    internal,
    unassigned,
    ambiguous,
    unplaced,
    historical,
    unresolved,
    partial: snapshot.partial,
    exclusions: snapshot.omissions.length,
    limits:
      "Components and relationship purposes are source interpretations. References establish static dependencies, not runtime order, data flow, correctness or accepted design. Freshness must be checked separately.",
  };
}

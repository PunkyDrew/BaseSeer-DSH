import type { CodeSnapshot } from "./code.ts";
import { PlanError, object, text } from "../domain/plan.ts";

export type ConnectionClaim = {
  from: string;
  to: string;
  kind: "calls" | "data" | "configures" | "uses";
  label: string;
  detail: string;
  citations: number[];
};
export type ConnectionCitation = {
  path: string;
  sha256: string;
  startLine: number;
  endLine: number;
  quote?: string;
};
export type ConnectionExplanation = {
  id: string;
  context: string;
  connections?: ConnectionClaim[];
  sources: ConnectionCitation[];
};
export type SourceConnection = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label: string;
  detail: string;
  basis: "observed" | "inferred";
  stale: boolean;
  citations: ConnectionCitation[];
};

// Citation matching grounds a claim; it never upgrades inference to verification.
export function connectionClaims(
  input: unknown,
  sources: ConnectionCitation[],
) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || !input.length || input.length > 12)
    throw new PlanError(
      "INVALID",
      "Use one to twelve source-backed connections.",
    );
  return input.map((value): ConnectionClaim => {
    const q = object(value, [
      "from",
      "to",
      "kind",
      "label",
      "detail",
      "citations",
    ]);
    const from = text(q.from, "connection origin", 400),
      to = text(q.to, "connection destination", 400),
      label = text(q.label, "connection label", 80),
      detail = text(q.detail, "connection explanation", 2000);
    if (
      from === to ||
      !label.trim() ||
      !detail.trim() ||
      !["calls", "data", "configures", "uses"].includes(String(q.kind))
    )
      throw new PlanError(
        "INVALID",
        "Name two distinct source files and explain their directed relationship.",
      );
    if (
      !Array.isArray(q.citations) ||
      !q.citations.length ||
      q.citations.length > 8 ||
      q.citations.some(
        (i) => !Number.isSafeInteger(i) || i < 0 || i >= sources.length,
      ) ||
      new Set(q.citations).size !== q.citations.length
    )
      throw new PlanError(
        "INVALID",
        "Connection citations must index the explanation's source citations (starting at zero).",
      );
    const refs = q.citations.map((i) => sources[i]);
    if (![from, to].every((p) => refs.some((r) => r.path === p)))
      throw new PlanError(
        "INVALID",
        "Cite inspected source at both ends of each connection.",
      );
    return {
      from,
      to,
      kind: q.kind as ConnectionClaim["kind"],
      label,
      detail,
      citations: q.citations,
    };
  });
}

export function sourceConnections(
  snapshot: CodeSnapshot & { context?: string },
  explanations: ConnectionExplanation[] = [],
) {
  const known = new Set(snapshot.files.map((f) => f.path));
  const observed: SourceConnection[] = snapshot.files.flatMap((file) =>
    file.imports.flatMap((i, index) =>
      i.target && known.has(i.target)
        ? [
            {
              id: `import:${file.path}:${i.line}:${index}`,
              from: file.path,
              to: i.target,
              kind: i.kind,
              label: i.kind === "type" ? "imports types" : "imports",
              detail: `${file.path} references ${i.specifier}. This resolves to ${i.target} within the inspected files. An import establishes a source dependency, not runtime order or a data flow.`,
              basis: "observed" as const,
              stale: false,
              citations: [
                {
                  path: file.path,
                  sha256: file.sha256,
                  startLine: i.line,
                  endLine: i.line,
                },
              ],
            },
          ]
        : [],
    ),
  );
  const inferred: SourceConnection[] = explanations.flatMap((e) =>
    (e.connections ?? []).map((c, index) => ({
      ...c,
      id: `inference:${e.id}:${index}`,
      basis: "inferred" as const,
      stale:
        e.context !== snapshot.context ||
        !known.has(c.from) ||
        !known.has(c.to),
      citations: c.citations.map((i) => e.sources[i]),
    })),
  );
  const staticReferences: SourceConnection[] = snapshot.files.flatMap((file) =>
    (file.analysis?.relationships ?? []).flatMap((r, index) => {
      const target =
        r.target && snapshot.files.find((f) => f.path === r.target!.path);
      if (!target || target.path === file.path || r.resolution !== "resolved")
        return [];
      return [
        {
          id: `static:${file.path}:${index}`,
          from: file.path,
          to: target.path,
          kind: `static-${r.kind}`,
          label: `${r.spelling} · ${r.kind === "inherits" ? "base declaration" : r.kind === "call" ? "call reference" : "reference"}`,
          detail: `${r.spelling} binds to an inspected declaration. ${file.analysis!.tool} ${file.analysis!.toolVersion}, adapter ${file.analysis!.adapterVersion}. This is a static source reference, not proof of runtime dispatch, execution or data flow.`,
          basis: "observed" as const,
          stale: false,
          citations: [
            {
              path: file.path,
              sha256: file.sha256,
              startLine: r.range.startLine,
              endLine: r.range.endLine,
            },
            {
              path: target.path,
              sha256: target.sha256,
              startLine: r.target!.range.startLine,
              endLine: r.target!.range.endLine,
            },
          ],
        },
      ];
    }),
  );
  return [...observed, ...staticReferences, ...inferred];
}

export function connectionNeighborhood(
  snapshot: CodeSnapshot,
  connections: SourceConnection[],
  requested = "",
) {
  const current = connections.filter((c) => !c.stale),
    known = new Map(snapshot.files.map((f) => [f.path, f]));
  const scores = new Map<string, number>();
  for (const c of current)
    for (const p of [c.from, c.to])
      scores.set(p, (scores.get(p) ?? 0) + (c.basis === "inferred" ? 10 : 1));
  const ranked = [...known.keys()].sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b),
  );
  const focus = known.has(requested) ? requested : (ranked[0] ?? "");
  const adjacent = current.filter((c) => c.from === focus || c.to === focus);
  const names = new Set(
    [focus, ...adjacent.flatMap((c) => [c.from, c.to])].filter(Boolean),
  );
  const selected = [focus, ...ranked.filter((n) => n !== focus && names.has(n))]
    .filter(Boolean)
    .slice(0, 80);
  const included = new Set(selected);
  const edges = current.filter(
    (c) => included.has(c.from) && included.has(c.to),
  );
  return {
    focus,
    files: selected.map((n) => known.get(n)!),
    connections: edges.slice(0, 200),
    omittedConnections: Math.max(0, edges.length - 200),
    omitted: names.size - selected.length,
    total: names.size,
    incoming: adjacent.filter((c) => c.to === focus),
    outgoing: adjacent.filter((c) => c.from === focus),
    historical: connections.filter(
      (c) => c.stale && (c.from === focus || c.to === focus),
    ),
    unresolved: known.get(focus)?.imports.filter((i) => !i.target) ?? [],
  };
}

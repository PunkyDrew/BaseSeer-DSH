import type { Document, Link, PlanningRecord } from "../domain/records.ts";
import { codeCheckCopy } from "./code-check-copy.ts";
import type { GraphSizes } from "./use-graph-measurements.ts";

export type GraphView = "Work" | "Review";
export type GraphItem = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  record?: string;
  basis?: string;
  supportTargets?: string[];
  link?: Link;
  details?: { label: string; text: string }[];
};
export type GraphNode = GraphItem & {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type GraphEdge = GraphItem & {
  from: string;
  to: string;
  type: string;
  points?: { x: number; y: number }[];
};
export type Diagram = { nodes: GraphNode[]; edges: GraphEdge[]; note: string };
export const nodeWidth = 224,
  nodeHeight = 112;

const linkKey = (link: Pick<Link, "from" | "to" | "kind">) =>
  JSON.stringify([link.from, link.to, link.kind]);

// Tasks encode prerequisites and acceptance references directly. Use the same
// derived relationships for the diagram and inspector without inventing storage.
export function recordLinks(doc: Document): Link[] {
  const links = [...doc.links];
  const seen = new Set(links.map(linkKey));
  const add = (link: Link) => {
    const key = linkKey(link);
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  for (const r of doc.records.filter((r) => r.kind === "task")) {
    for (const to of r.data.dependencies)
      add({
        id: `dependency:${r.id}:${to}`,
        from: r.id,
        to,
        kind: "depends-on",
        scope:
          "This task needs the task the arrow points to finished first. No separate reason has been saved.",
        provenance: `Task record: ${r.id}`,
        evidence: [],
      });
    for (const c of r.data.criteria)
      add({
        id: `criterion:${r.id}:${c.requirement}`,
        from: r.id,
        to: c.requirement,
        kind: "satisfies",
        scope: `This task is intended to meet version ${c.version} of the requirement. This arrow does not show that the work is finished or checked.`,
        provenance: `Task acceptance criteria: ${r.id}`,
        evidence: [],
      });
  }
  return links;
}

function description(r: PlanningRecord): string {
  const d = r.data;
  return (
    d.responsibility ??
    d.scope ??
    d.choice ??
    d.question ??
    d.description ??
    d.statement ??
    d.path ??
    d.capability ??
    ""
  );
}

// The folded pictures of the plan's follow-up work and its checks: a
// projection of committed records. Layout never creates design facts.
export function projectGraphRecords(
  doc: Document,
  view: GraphView,
  sizes: GraphSizes = {},
): Diagram {
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = [];
  const add = (item: GraphItem) =>
    nodes.push({
      ...item,
      x: 0,
      y: 0,
      width: sizes[item.id]?.width ?? nodeWidth,
      height: sizes[item.id]?.height ?? nodeHeight,
    });
  const kinds =
    view === "Review"
      ? [
          "requirement",
          "component",
          "interface",
          "mapping",
          "claim",
          "evidence",
          "finding",
          "analysis",
        ]
      : ["task"];
  const links = recordLinks(doc);
  const connected = new Set(
    doc.records
      .filter((r) =>
        ["claim", "evidence", "finding", "analysis"].includes(r.kind),
      )
      .map((r) => r.id),
  );
  if (view === "Review") {
    // Follow evidence to its subject and source; unrelated architecture is not
    // a second overview and unverified requirements are not fabricated checks.
    for (let pass = 0; pass < 2; pass++) {
      const before = new Set(connected);
      for (const l of links)
        if (
          [
            "supports",
            "contradicts",
            "maps-to",
            "satisfies",
            "addresses",
          ].includes(l.kind) &&
          (before.has(l.from) || before.has(l.to))
        ) {
          connected.add(l.from);
          connected.add(l.to);
        }
    }
  }
  for (const r of doc.records.filter(
    (r) =>
      kinds.includes(r.kind) && (view !== "Review" || connected.has(r.id)),
  ))
    add({
      id: r.id,
      record: r.id,
      title: r.kind === "analysis" ? codeCheckCopy(r, doc).title : r.title,
      kind: r.kind === "analysis" ? "Code check" : r.kind,
      summary:
        r.kind === "analysis" ? codeCheckCopy(r, doc).result : description(r),
    });
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const insert = (l: Link) => {
    if (!ids.has(l.from) || !ids.has(l.to)) return;
    const key = linkKey(l);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      id: l.id,
      from: l.from,
      to: l.to,
      type: l.kind,
      title: l.kind.replaceAll("-", " "),
      kind: "Relationship",
      summary: l.scope,
      link: l,
    });
  };
  links.forEach(insert);
  const note =
    view === "Work"
      ? "Each box is planned follow-up work, such as a codebase mapping's suggestions. A → B means task A needs task B done first. Tasks are not components or runtime steps."
      : "Only recorded claims, findings and evidence, with their connected subjects, are shown. Missing links and unverified requirements remain visible in the review below; unrelated components are not repeated here.";
  return { nodes, edges, note };
}

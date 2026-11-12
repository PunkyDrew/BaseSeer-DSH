import type { Document, Link, PlanningRecord } from "../../domain/records.ts";
import { nodeHeight, nodeWidth } from "../graph-model.ts";
import { cardFiles } from "../graph-card.ts";
import type { GraphSizes } from "../use-graph-measurements.ts";
import { wrapText } from "./geometry.ts";
import type {
  StructuralEdge,
  StructuralNode,
  StructuralProjection,
  Symbol,
} from "./types.ts";

// Containment comes only from component.data.parent and a part's symbol only
// from component.data.c4; neither is inferred from paths, imports, titles or
// dependency arrows.

/** The comments drawn beside the parts: the plan's requirements, decisions and questions, and its source links. */
export type Layers = { traceability: boolean; sources: boolean };
const commentKinds: Record<keyof Layers, string[]> = {
  traceability: ["requirement", "decision", "question"],
  sources: ["mapping"],
};
/** The links that anchor a comment to what it concerns. */
const anchorKinds = ["satisfies", "addresses", "maps-to"];

/** Ancestor chains from component.data.parent, with cycle/missing warnings. */
export function containmentIndex(records: readonly PlanningRecord[]) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const warnings: string[] = [];
  const ancestors = new Map<string, string[]>();
  for (const r of records.filter((r) => r.kind === "component")) {
    const seen = new Set([r.id]),
      chain: string[] = [];
    let parent: string | undefined = r.data.parent;
    while (parent) {
      if (seen.has(parent)) {
        warnings.push(
          `Containment loop at ${r.title}; grouping is incomplete.`,
        );
        break;
      }
      seen.add(parent);
      const value = byId.get(parent);
      if (!value || value.kind !== "component") {
        warnings.push(`${r.title} names a missing container ${parent}.`);
        break;
      }
      chain.push(parent);
      parent = value.data.parent;
    }
    ancestors.set(r.id, chain);
  }
  return { byId, ancestors, warnings: [...new Set(warnings)] };
}

const symbolOf = (r: PlanningRecord): Symbol =>
  r.kind === "interface"
    ? "interface"
    : r.data.c4?.level === "person"
      ? "person"
      : "component";
/** The element's stereotype the way UML writes it. */
const typeLine = (symbol: Symbol) =>
  symbol === "interface"
    ? "«interface»"
    : symbol === "person"
      ? "«actor»"
      : "«component»";
/** A part as a UML component, interface or actor box, drawn inside its displayed container when it has one. */
export function partNode(
  r: PlanningRecord,
  status: string,
  sizes: GraphSizes,
  parent: PlanningRecord | null,
  boundary: boolean,
): StructuralNode {
  const symbol = symbolOf(r),
    files = cardFiles(r);
  return {
    id: r.id,
    record: r.id,
    title: r.title,
    kind: symbol,
    summary: r.data.responsibility ?? "",
    symbol,
    typeLine: typeLine(symbol),
    files,
    attributes: [],
    external: Boolean(r.data.c4?.external),
    status,
    parent: parent?.id ?? null,
    boundary,
    x: 0,
    y: 0,
    width: boundary ? 0 : (sizes[r.id]?.width ?? nodeWidth),
    height: sizes[r.id]?.height ?? nodeHeight + (files.length ? 42 : 0),
    ...(parent ? { details: [{ label: "Inside", text: parent.title }] } : {}),
  };
}
/** A requirement, decision, question or source link as a UML comment. */
function comment(r: PlanningRecord, status: string, sizes: GraphSizes): StructuralNode {
  return {
    id: r.id,
    record: r.id,
    title: r.title,
    kind: r.kind,
    summary:
      r.data.scope ?? r.data.choice ?? r.data.question ?? r.data.path ?? "",
    symbol: "comment",
    typeLine: `«${r.kind === "mapping" ? "source" : r.kind}»`,
    files: [],
    attributes: [],
    external: false,
    status,
    parent: null,
    boundary: false,
    x: 0,
    y: 0,
    width: sizes[r.id]?.width ?? nodeWidth,
    height: sizes[r.id]?.height ?? 72,
  };
}

/** UML components: every part and interface of the plan, nested by containment, with its dependencies and realizations, and the comments a layer adds. */
export function projectStructural(
  doc: Document,
  status: (r: PlanningRecord) => string,
  sizes: GraphSizes = {},
  layers: Layers = { traceability: false, sources: false },
): StructuralProjection {
  const { byId, ancestors, warnings } = containmentIndex(doc.records);
  const parts = doc.records.filter((r) =>
    ["component", "interface"].includes(r.kind),
  );
  const partIds = new Set(parts.map((r) => r.id));
  // A part is drawn inside its nearest recorded container.
  const parents = new Map(
    parts.map((r) => [
      r.id,
      (ancestors.get(r.id) ?? []).find((a) => partIds.has(a)) ?? null,
    ]),
  );
  const hasChildren = new Set([...parents.values()].filter(Boolean));
  const drawn = (Object.keys(commentKinds) as (keyof Layers)[])
    .filter((layer) => layers[layer])
    .flatMap((layer) => commentKinds[layer]);
  const comments = doc.records.filter((r) => drawn.includes(r.kind));
  const nodes = [
    ...parts.map((r) =>
      partNode(
        r,
        status(r),
        sizes,
        parents.get(r.id) ? byId.get(parents.get(r.id)!)! : null,
        hasChildren.has(r.id),
      ),
    ),
    ...comments.map((r) => comment(r, status(r), sizes)),
  ];
  const shown = new Set(nodes.map((n) => n.id));
  // Descendant check so a part→container relation is shown by nesting, not
  // by an arrow into its own boundary.
  const contains = (outer: string, inner: string) => {
    for (let p = parents.get(inner); p; p = parents.get(p) ?? null)
      if (p === outer) return true;
    return false;
  };
  let internalLinks = 0,
    outside = 0;
  // Several relationships of one kind between the same two boxes are one
  // dependency; its details list them.
  const pairs = new Map<
    string,
    { from: string; to: string; type: string; links: Link[] }
  >();
  const anchors: Link[] = [];
  for (const link of doc.links) {
    if (anchorKinds.includes(link.kind)) {
      if (shown.has(link.from) && shown.has(link.to)) anchors.push(link);
      continue;
    }
    if (!["uses", "implements"].includes(link.kind)) continue;
    if (!partIds.has(link.from) || !partIds.has(link.to)) {
      outside++;
      continue;
    }
    if (
      link.from === link.to ||
      contains(link.from, link.to) ||
      contains(link.to, link.from)
    ) {
      internalLinks++;
      continue;
    }
    const key = JSON.stringify([link.from, link.to, link.kind]);
    const pair = pairs.get(key) ?? { from: link.from, to: link.to, type: link.kind, links: [] };
    pair.links.push(link);
    pairs.set(key, pair);
  }
  const title = (id: string) => byId.get(id)?.title ?? id;
  const edges: StructuralEdge[] = [
    ...[...pairs.values()].map(({ from, to, type, links }) => ({
      id: links.length === 1 ? links[0].id : `${from}>${to}:${type}`,
      from,
      to,
      type,
      title: type,
      kind: "Relationship",
      summary: links[0].scope,
      label: [],
      link: links.length === 1 ? links[0] : undefined,
      ...(links.length > 1
        ? {
            details: links.map((link) => ({
              label: `${title(link.from)} ${link.kind} ${title(link.to)}`,
              text: link.scope || "No reason recorded.",
            })),
          }
        : {}),
    })),
    ...anchors.map((link) => ({
      id: link.id,
      from: link.from,
      to: link.to,
      type: "anchor",
      title: link.kind.replaceAll("-", " "),
      kind: "Relationship",
      summary: link.scope,
      label: [],
      link,
    })),
  ];
  if (internalLinks)
    warnings.push(
      `${internalLinks} relationships fall inside one box or between a part and its container; nesting shows them.`,
    );
  if (outside)
    warnings.push(`${outside} relationships involve items not shown here.`);
  return {
    nodes,
    edges,
    note: "UML Component: each component and interface. A dashed arrow with an open head is a dependency (the part uses what it points to); a dashed arrow with a hollow triangle is a realization (the part provides that interface). A component drawn inside another is part of it. A comment with a folded corner is a requirement, decision, question or source link, its dashed line anchoring it to what it concerns.",
    empty: "No components or interfaces are recorded yet. Discuss the system's responsibilities and boundaries in chat.",
    warnings: [...new Set(warnings)],
  };
}

/** A part with what uses it above and what it uses below, from the plan's links: a UML component diagram of one part. */
export function projectPartLinks(
  doc: Document,
  part: string,
  status: (r: PlanningRecord) => string,
  sizes: GraphSizes = {},
): StructuralProjection {
  const byId = new Map(doc.records.map((r) => [r.id, r]));
  const links = doc.links.filter(
    (l) =>
      ["uses", "implements"].includes(l.kind) &&
      (l.from === part || l.to === part) &&
      byId.has(l.from) &&
      byId.has(l.to),
  );
  const ids = [...new Set([part, ...links.flatMap((l) => [l.from, l.to])])];
  const nodes = ids.map((id) => {
    const r = byId.get(id)!;
    return partNode(r, status(r), sizes, null, false);
  });
  const edges: StructuralEdge[] = links.map((link) => ({
    id: link.id,
    from: link.from,
    to: link.to,
    type: link.kind,
    title: link.scope || link.kind,
    kind: "Relationship",
    summary: link.scope,
    label: wrapText(link.scope || link.kind, 30, 2),
    link,
  }));
  const title = byId.get(part)?.title ?? part;
  return {
    nodes,
    edges,
    note: `What uses ${title}, and what ${title} uses, from the plan's links. Each arrow carries the reason recorded for it.`,
    empty: "",
    warnings: [
      `No recorded flow shows the steps of ${title} yet. Ask in chat to map the operations it takes part in.`,
    ],
  };
}

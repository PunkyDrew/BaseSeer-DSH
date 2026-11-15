import type { Document, Link, PlanningRecord } from "../../domain/records.ts";
import { nodeHeight, nodeWidth } from "../graph-model.ts";
import { cardFiles } from "../graph-card.ts";
import type { GraphSizes } from "../use-graph-measurements.ts";
import { wrapText } from "./geometry.ts";
import { containmentIndex, partLevels, type DiagramLevel } from "./levels.ts";
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
/**
 * What a box's card is measured under. An open container's frame shares its
 * id with the closed box it is one level up, and its card spans the whole
 * frame, so it is measured apart: going back up draws the closed box at its
 * own size.
 */
export const sizeKey = (id: string, boundary: boolean) => (boundary ? `${id}#frame` : id);

/** A part as a UML component, interface or actor box, drawn inside its displayed container when it has one. */
export function partNode(
  r: PlanningRecord,
  status: string,
  sizes: GraphSizes,
  parent: PlanningRecord | null,
  boundary: boolean,
): StructuralNode {
  const symbol = symbolOf(r),
    files = cardFiles(r),
    measured = sizes[sizeKey(r.id, boundary)];
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
    width: boundary ? 0 : (measured?.width ?? nodeWidth),
    height: measured?.height ?? nodeHeight + (files.length ? 42 : 0),
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

/**
 * The boxes a component diagram draws for its parts. The whole plan draws
 * every part inside its nearest container. A level draws the parts directly
 * in it, each container among them closed with a count of what it holds, the
 * open container as the boundary around them, and the boxes outside it that
 * its parts depend on or are used by.
 */
function partBoxes(doc: Document, level: DiagramLevel | undefined) {
  const levels = partLevels(doc);
  const parts = doc.records.filter((r) =>
    ["component", "interface"].includes(r.kind),
  );
  if (level === undefined) {
    const { ancestors } = containmentIndex(doc.records);
    const parents = new Map(
      parts.map((r) => [r.id, ancestors.get(r.id)?.[0] ?? null]),
    );
    const hasChildren = new Set([...parents.values()].filter(Boolean));
    return {
      levels,
      inner: parts,
      boundary: null,
      box: (id: string): string | null => (parents.has(id) ? id : null),
      parent: (id: string) => parents.get(id) ?? null,
      open: (id: string) => hasChildren.has(id),
      folded: (_id: string) => 0,
    };
  }
  return {
    levels,
    inner: levels.children(level),
    boundary: level ? (levels.byId.get(level) ?? null) : null,
    box: (id: string) => levels.boxOn(id, level),
    parent: (id: string) =>
      level && levels.within(id, level) ? level : null,
    open: (_id: string) => false,
    folded: (id: string) => levels.inside(id),
  };
}

/**
 * UML components, with dependencies and realizations and the comments a layer
 * adds: every part of the plan nested by containment, or, given a level, the
 * diagram of that level alone.
 */
export function projectStructural(
  doc: Document,
  status: (r: PlanningRecord) => string,
  sizes: GraphSizes = {},
  layers: Layers = { traceability: false, sources: false },
  level?: DiagramLevel,
): StructuralProjection {
  const boxes = partBoxes(doc, level);
  const { byId, warnings } = containmentIndex(doc.records);
  const drawn = (Object.keys(commentKinds) as (keyof Layers)[])
    .filter((layer) => layers[layer])
    .flatMap((layer) => commentKinds[layer]);
  const parentRecord = (id: string) => byId.get(boxes.parent(id) ?? "") ?? null;
  const nodes: StructuralNode[] = boxes.inner.map((r) => ({
    ...partNode(r, status(r), sizes, parentRecord(r.id), boxes.open(r.id)),
    ...(boxes.folded(r.id) ? { folded: boxes.folded(r.id) } : {}),
  }));
  if (boxes.boundary)
    nodes.unshift(partNode(boxes.boundary, status(boxes.boundary), sizes, null, true));
  const shown = new Set(nodes.map((n) => n.id));
  // A box outside the open level joins the diagram when something inside
  // depends on it or uses it.
  const context = (id: string) => {
    if (shown.has(id)) return;
    const r = byId.get(id)!;
    nodes.push({
      ...partNode(r, status(r), sizes, null, false),
      ...(boxes.folded(id) ? { folded: boxes.folded(id) } : {}),
    });
    shown.add(id);
  };
  const isPart = (id: string) =>
    ["component", "interface"].includes(byId.get(id)?.kind ?? "");
  const inside = (id: string) =>
    level === undefined || boxes.levels.within(id, level);
  // Descendant check so a part→container relation is shown by nesting, not
  // by an arrow into its own boundary.
  const contains = (outer: string, inner: string) => {
    for (let p = boxes.parent(inner); p; p = boxes.parent(p))
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
  for (const link of doc.links) {
    if (!["uses", "implements"].includes(link.kind)) continue;
    if (!isPart(link.from) || !isPart(link.to)) {
      outside++;
      continue;
    }
    if (!inside(link.from) && !inside(link.to)) continue;
    const from = boxes.box(link.from),
      to = boxes.box(link.to);
    // Inside one closed container, a relationship belongs to that
    // container's own diagram.
    if (from && from === to && level !== undefined) continue;
    if (!from || !to || from === to || contains(from, to) || contains(to, from)) {
      internalLinks++;
      continue;
    }
    context(from);
    context(to);
    const key = JSON.stringify([from, to, link.kind]);
    const pair = pairs.get(key) ?? { from, to, type: link.kind, links: [] };
    pair.links.push(link);
    pairs.set(key, pair);
  }
  // A comment's dashed line anchors it to the box its subject is drawn as.
  // The whole plan draws every comment; a level draws those whose subject
  // has a box there.
  const isComment = (id: string) => drawn.includes(byId.get(id)?.kind ?? "");
  const boxShown = (id: string) => {
    const box = boxes.box(id);
    return box && shown.has(box) ? box : null;
  };
  const comments = doc.records.filter(
    (r) =>
      isComment(r.id) &&
      (level === undefined ||
        doc.links.some(
          (l) =>
            anchorKinds.includes(l.kind) &&
            ((l.from === r.id && boxShown(l.to)) || (l.to === r.id && boxShown(l.from))),
        )),
  );
  nodes.push(...comments.map((r) => comment(r, status(r), sizes)));
  for (const r of comments) shown.add(r.id);
  const end = (id: string) => (isComment(id) ? (shown.has(id) ? id : null) : boxShown(id));
  const anchors = doc.links.flatMap((link) => {
    if (!anchorKinds.includes(link.kind)) return [];
    const from = end(link.from),
      to = end(link.to);
    return from && to ? [{ link, from, to }] : [];
  });
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
    ...anchors.map(({ link, from, to }) => ({
      id: link.id,
      from,
      to,
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

import type { Document, PlanningRecord } from "../../domain/records.ts";
import { nodeHeight } from "../graph-model.ts";
import type { GraphSizes } from "../use-graph-measurements.ts";
import { clip } from "./geometry.ts";
import { containmentIndex, partNode } from "./structural.ts";
import type {
  StructuralEdge,
  StructuralNode,
  StructuralProjection,
} from "./types.ts";

// What runs where, as a UML deployment diagram. A container (c4.level
// container) is an «executionEnvironment» node, a 3D box named with its
// technology; a system, the planned one or an outside one, is a plain node
// holding its containers; a component is drawn inside the node it runs in,
// the nearest container or system around it; a person is an «actor». A
// dependency between parts that run apart is a communication path between
// their nodes, labelled with the format of the interface it crosses.

/** How far a node's top and side faces stand off its front, in drawing units. */
export const NODE_DEPTH = 10;
const placeLevels = ["system", "container"];

export function projectDeployment(
  doc: Document,
  status: (r: PlanningRecord) => string,
  sizes: GraphSizes = {},
): StructuralProjection {
  const { byId, ancestors, warnings } = containmentIndex(doc.records);
  const components = doc.records.filter((r) => r.kind === "component");
  const level = (r: PlanningRecord | undefined) => r?.data.c4?.level ?? "";
  const isPlace = (r: PlanningRecord | undefined) => placeLevels.includes(level(r));
  const places = components.filter(isPlace);
  const note =
    "UML deployment diagram: a 3D box is a node, somewhere software runs. One marked «executionEnvironment» is a container, a process or runtime, named with its technology; the «component»s drawn inside it run there, and a node drawn inside another is part of that system. A solid line between nodes is a communication path, labelled with the format of the interface that crosses it.";
  if (!places.length)
    return {
      nodes: [],
      edges: [],
      note,
      empty: "No containers are recorded yet. Say in chat which parts run as a process, and where, to see what runs where.",
      warnings: [],
    };
  const enclosing = (id: string) =>
    (ancestors.get(id) ?? []).find((a) => isPlace(byId.get(a))) ?? null;
  const others = components.filter((r) => !isPlace(r));
  const parentOf = new Map(
    components.map((r) => [r.id, level(r) === "person" ? null : enclosing(r.id)]),
  );
  const hasChildren = new Set([...parentOf.values()].filter(Boolean));
  const cube = (r: PlanningRecord): StructuralNode => {
    const boundary = hasChildren.has(r.id);
    const base = partNode(r, status(r), sizes, byId.get(parentOf.get(r.id) ?? "") ?? null, boundary);
    return {
      ...base,
      kind: "node",
      symbol: "node",
      typeLine: level(r) === "container" ? "«executionEnvironment»" : "",
      summary: r.data.technology ?? r.data.responsibility ?? "",
      files: [],
      width: boundary ? 0 : base.width + NODE_DEPTH,
      height: (sizes[r.id]?.height ?? nodeHeight) + NODE_DEPTH,
    };
  };
  const nodes = [
    ...places.map(cube),
    ...others.map((r) =>
      partNode(r, status(r), sizes, byId.get(parentOf.get(r.id) ?? "") ?? null, false),
    ),
  ];
  const unplaced = others.filter((r) => level(r) !== "person" && !parentOf.get(r.id)).length;
  if (unplaced)
    warnings.push(`${unplaced} parts are not placed in a container; say in chat where each runs.`);
  // Where a part runs: the node it is, or the nearest it sits inside; a part
  // placed nowhere stands for itself. An interface is provided where the part
  // that implements it runs.
  const placeOf = (id: string) => {
    const r = byId.get(id);
    if (r?.kind !== "component") return null;
    return isPlace(r) ? r.id : (enclosing(id) ?? r.id);
  };
  const provider = new Map<string, string>();
  for (const l of doc.links)
    if (l.kind === "implements" && !provider.has(l.to)) provider.set(l.to, l.from);
  const end = (id: string) => {
    const r = byId.get(id);
    if (r?.kind !== "interface") return { place: placeOf(id), format: "" };
    const p = provider.get(id);
    return p ? { place: placeOf(p), format: r.data.format ?? "" } : null;
  };
  const within = (outer: string, inner: string) => (ancestors.get(inner) ?? []).includes(outer);
  let unprovided = 0;
  const pairs = new Map<string, { from: string; to: string; formats: Set<string> }>();
  for (const link of doc.links) {
    if (!["uses", "implements"].includes(link.kind)) continue;
    const a = end(link.from),
      b = end(link.to);
    if (!a || !b) {
      unprovided++;
      continue;
    }
    if (!a.place || !b.place || a.place === b.place || within(a.place, b.place) || within(b.place, a.place)) continue;
    const key = [a.place, b.place].sort().join(">");
    const pair = pairs.get(key) ?? { from: a.place, to: b.place, formats: new Set<string>() };
    for (const f of [a.format, b.format]) if (f) pair.formats.add(f);
    pairs.set(key, pair);
  }
  if (unprovided)
    warnings.push(`${unprovided} relationships cross an interface no part provides, so where they land is not drawn.`);
  const edges: StructuralEdge[] = [...pairs.values()].map(({ from, to, formats }) => ({
    id: `${from}>${to}:path`,
    from,
    to,
    type: "path",
    title: "communication path",
    kind: "Relationship",
    summary: formats.size
      ? `What crosses: ${[...formats].join(", ")}.`
      : "Parts that run apart depend on one another; no interface format is recorded between them.",
    label: formats.size ? [clip([...formats].join(", "), 34)] : [],
  }));
  return { nodes, edges, note, empty: "", warnings: [...new Set(warnings)] };
}

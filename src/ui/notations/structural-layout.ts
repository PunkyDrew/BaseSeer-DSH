import ELK from "elkjs/lib/elk.bundled.js";
import type {
  ElkExtendedEdge,
  ElkNode,
  ELK as Engine,
  ELKConstructorArguments,
} from "elkjs/lib/elk-api.js";
import { routeLabelPoint, textWidth } from "./geometry.ts";
import type { Point, Rect, StructuralProjection } from "./types.ts";

const Constructor = ELK as unknown as {
  new (options: ELKConstructorArguments): Engine;
};
const engine = new Constructor({ algorithms: ["layered", "rectpacking"] });
const round = (n: number) => Math.round(n * 1000) / 1000;

export interface StructuralLayout {
  boxes: Map<string, Rect>;
  routes: Map<string, Point[]>;
  labels: Map<string, Point>;
  viewBox: Rect;
}

// One compound layered layout: containers are ELK parents, so boundaries,
// boxes and orthogonal routes come from the same pass. ROOT coordinates make
// every shape and route absolute, independent of nesting depth. It reads top
// to bottom, as UML diagrams usually do, so a phone scrolls it down.
export async function structuralLayout(
  p: StructuralProjection,
): Promise<StructuralLayout> {
  const children = new Map<string | null, string[]>();
  for (const n of p.nodes)
    children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const joined = new Set(p.edges.flatMap((e) => [e.from, e.to]));
  const build = (id: string): ElkNode => {
    const node = byId.get(id)!,
      inner = children.get(id) ?? [];
    return inner.length
      ? {
          id,
          layoutOptions: {
            "elk.padding": `[top=${node.height + 12},left=16,bottom=16,right=16]`,
          },
          children: pack(id, inner),
        }
      : { id, width: node.width, height: node.height };
  };
  // Parts with no arrow at this level have no layer to go in, so layering
  // would line them all up in one row. They are packed into a block as wide
  // as a screen instead, below the parts the arrows join, so the level reads
  // from its connected parts down and never runs off to one side.
  const pack = (container: string, inner: string[]): ElkNode[] => {
    const loose = new Set(inner.filter((id) => !joined.has(id) && !children.has(id)));
    if (loose.size < 2) return inner.map(build);
    return [
      ...inner.filter((id) => !loose.has(id)).map(build),
      {
        id: `${container}:loose`,
        layoutOptions: {
          "elk.algorithm": "rectpacking",
          "elk.hierarchyHandling": "SEPARATE_CHILDREN",
          "elk.layered.layering.layerConstraint": "LAST",
          "elk.padding": "[top=0,left=0,bottom=0,right=0]",
          "elk.spacing.nodeNode": "40",
          "elk.aspectRatio": "1.2",
        },
        children: [...loose].map(build),
      },
    ];
  };
  const graph: ElkNode = {
    id: "diagram",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      // Arrows into the same box share a trunk, as UML draws them, so a much
      // used part is one line in, not a bundle of parallel ones.
      "elk.layered.mergeEdges": "true",
      "elk.layered.feedbackEdges": "false",
      // Layers hold at most a few parts, so a level of many parts grows down,
      // the way it scrolls, instead of into one row wider than any screen.
      "elk.layered.layering.strategy": "MIN_WIDTH",
      "elk.layered.layering.minWidth.upperBoundOnWidth": "3",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeEdge": "18",
      "elk.spacing.edgeLabel": "4",
      "elk.spacing.labelLabel": "6",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.edgeLabels.placement": "CENTER",
      "elk.spacing.edgeNode": "24",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
      "elk.randomSeed": "1",
    },
    children: pack("diagram", children.get(null) ?? []),
    edges: p.edges.map((e) => ({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
      // ELK reserves room for each label so labels never pile up on a port.
      labels: e.label.length
        ? [
            {
              id: `${e.id}:label`,
              text: e.label.join(" "),
              width: Math.max(...e.label.map(textWidth)) + 12,
              height: 15 * e.label.length + 4,
            },
          ]
        : [],
    })),
  };
  const output = await engine.layout(graph);
  const boxes = new Map<string, Rect>();
  const found: ElkExtendedEdge[] = [];
  const walk = (n: ElkNode) => {
    if (byId.has(n.id))
      boxes.set(n.id, {
        x: round(n.x!),
        y: round(n.y!),
        width: round(n.width!),
        height: round(n.height!),
      });
    found.push(...(n.edges ?? []));
    (n.children ?? []).forEach(walk);
  };
  walk(output);
  const routes = new Map<string, Point[]>(),
    labels = new Map<string, Point>();
  for (const edge of found) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((pt) => ({ x: round(pt.x), y: round(pt.y) }));
    routes.set(edge.id, points);
    const label = edge.labels?.[0];
    if (label)
      labels.set(
        edge.id,
        label.x !== undefined && label.y !== undefined
          ? { x: round(label.x + label.width! / 2), y: round(label.y + 12) }
          : routeLabelPoint(points)!,
      );
  }
  if (routes.size !== p.edges.length)
    throw new Error("Missing complete diagram connection");
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (r: Rect) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  };
  boxes.forEach(include);
  routes.forEach((pts) =>
    pts.forEach((pt) => include({ ...pt, width: 0, height: 0 })),
  );
  for (const e of p.edges) {
    const pt = labels.get(e.id);
    if (!pt) continue;
    const width = Math.max(...e.label.map(textWidth));
    include({ x: pt.x - width / 2, y: pt.y - 14, width, height: 15 * e.label.length + 6 });
  }
  const pad = 24;
  return {
    boxes,
    routes,
    labels,
    viewBox: Number.isFinite(minX)
      ? {
          x: minX - pad,
          y: minY - pad,
          width: maxX - minX + pad * 2,
          height: maxY - minY + pad * 2,
        }
      : { x: 0, y: 0, width: 400, height: 200 },
  };
}

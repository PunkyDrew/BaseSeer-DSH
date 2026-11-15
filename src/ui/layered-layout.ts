import ELK from "elkjs/lib/elk.bundled.js";
import type {
  ElkNode,
  ELK as Engine,
  ELKConstructorArguments,
} from "elkjs/lib/elk-api.js";
import type { Box, LayoutEdge, LayoutInput, Point } from "./graph-routing.ts";
export type { LayoutEdge, LayoutInput };
import { straightenEdges } from "./straighten-edges.ts";

// elkjs exposes a CommonJS constructor with an ESM-shaped declaration file.
const Constructor = ELK as unknown as {
  new (options: ELKConstructorArguments): Engine;
};
const engine = new Constructor({ algorithms: ["layered"] });
const round = (n: number) => Math.round(n * 1000) / 1000;

// The space between the sides of a split layout and the row under its focus.
const ROW_GAP = 40;

// One layered layout owns node alignment, port assignment, label placement and
// orthogonal routing. Do not reroute its edges independently of the boxes.
export async function layeredLayout<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
): Promise<LayoutInput<N, E & LayoutEdge>> {
  if (!input.nodes.length) return { nodes: [], edges: [] };
  if (input.focus) return splitLayout(input, input.focus);
  return arrange(input);
}

function only<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
  keep: (id: string) => boolean,
): LayoutInput<N, E> {
  return {
    ...input,
    nodes: input.nodes.filter((n) => keep(n.id)),
    edges: input.edges.filter((e) => keep(e.from) && keep(e.to)),
  };
}

// The boxes the focus uses follow it and the boxes that use it come before it, as the layered
// layout puts them. A box that does both would land on one side with its return arrow looped
// round the focus, so the two-way boxes get their own row past the focus instead, each drawn
// once with both arrows running straight to it.
async function splitLayout<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
  focus: string,
): Promise<LayoutInput<N, E & LayoutEdge>> {
  const uses = new Set(input.edges.filter((e) => e.from === focus).map((e) => e.to));
  const usedBy = new Set(input.edges.filter((e) => e.to === focus).map((e) => e.from));
  const twoWay = (id: string) => id !== focus && uses.has(id) && usedBy.has(id);
  const sides = await arrange(only(input, (id) => !twoWay(id)));
  if (!input.nodes.some((n) => twoWay(n.id))) return sides;
  const rowDirection = input.direction === "DOWN" ? "RIGHT" : "DOWN";
  const row = await arrange(
    { ...only(input, (id) => id === focus || twoWay(id)), direction: rowDirection },
    focus,
  );
  return besideFocus(sides, row, focus, rowDirection);
}

// Moves the row's drawing onto the focus of the sides' drawing, and stretches the row's arrows
// across the axis so everything past the focus clears the sides.
function besideFocus<N extends Box, E extends LayoutEdge>(
  sides: LayoutInput<N, E>,
  row: LayoutInput<N, E>,
  focus: string,
  rowDirection: "RIGHT" | "DOWN",
): LayoutInput<N, E> {
  const across = rowDirection === "DOWN" ? "y" : "x",
    along = across === "y" ? "x" : "y",
    extent = across === "y" ? "height" : "width";
  const anchor = sides.nodes.find((n) => n.id === focus)!,
    origin = row.nodes.find((n) => n.id === focus)!;
  const originEnd = origin[across] + origin[extent];
  const sidesEnd = Math.max(
    ...sides.nodes.map((n) => n[across] + n[extent]),
    ...sides.edges.flatMap((e) => [
      ...e.points!.map((p) => p[across]),
      ...(e.label ? [e.label[across] + e.label[extent] / 2] : []),
    ]),
  );
  const stretch = sidesEnd + ROW_GAP - (anchor[across] + anchor[extent]);
  const move = <P extends Point>(p: P): P => ({
    ...p,
    [along]: round(p[along] + anchor[along] - origin[along]),
    [across]: round(
      p[across] + anchor[across] - origin[across] + (p[across] > originEnd ? stretch : 0),
    ),
  });
  const moved = new Map([
    ...sides.edges.map((e) => [e.id, e] as const),
    ...row.edges.map(
      (e) =>
        [
          e.id,
          { ...e, points: e.points!.map(move), ...(e.label ? { label: move(e.label) } : {}) },
        ] as const,
    ),
  ]);
  return {
    nodes: [...sides.nodes, ...row.nodes.filter((n) => n.id !== focus).map(move)],
    edges: [...moved.values()],
  };
}

// `first` is held in the first layer, so every arrow to or from it leaves the same side.
async function arrange<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
  first?: string,
): Promise<LayoutInput<N, E & LayoutEdge>> {
  const graph: ElkNode = {
    id: "diagram",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": input.direction ?? "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.layered.mergeEdges": "false",
      "elk.layered.unnecessaryBendpoints": "false",
      "elk.layered.feedbackEdges": "false",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "60",
      "elk.spacing.edgeEdge": "18",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
      "elk.spacing.edgeNode": "24",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.edgeLabels.inline": "true",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
      "elk.randomSeed": "1",
    },
    children: input.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      ...(n.id === first
        ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } }
        : {}),
    })),
    edges: input.edges.map((e) => ({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
      ...(e.priority === undefined
        ? {}
        : {
            layoutOptions: {
              "elk.layered.priority.direction": String(e.priority),
            },
          }),
      ...(e.label
        ? {
            labels: [
              {
                id: e.id + ":label",
                text: e.title || e.id,
                width: e.label.width,
                height: e.label.height,
              },
            ],
          }
        : {}),
    })),
  };
  const output = await engine.layout(graph);
  const nodes = new Map(output.children!.map((n) => [n.id, n])),
    edges = new Map(output.edges!.map((e) => [e.id, e]));
  return straightenEdges({
    nodes: input.nodes.map((n) => ({
      ...n,
      x: round(nodes.get(n.id)!.x!),
      y: round(nodes.get(n.id)!.y!),
    })),
    edges: input.edges.map((e) => {
      const edge = edges.get(e.id)!,
        section = edge.sections?.[0];
      if (!section || edge.sections!.length !== 1)
        throw new Error("Missing complete diagram connection");
      const points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ].map((p) => ({ x: round(p.x), y: round(p.y) }));
      const label = edge.labels?.[0];
      return {
        ...e,
        points,
        ...(label
          ? {
              label: {
                x: round(label.x! + label.width! / 2),
                y: round(label.y! + label.height! / 2),
                width: label.width!,
                height: label.height!,
              },
            }
          : {}),
      };
    }),
  });
}

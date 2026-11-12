import ELK from "elkjs/lib/elk.bundled.js";
import type {
  ElkNode,
  ELK as Engine,
  ELKConstructorArguments,
} from "elkjs/lib/elk-api.js";
import type { Box, LayoutEdge, LayoutInput } from "./graph-routing.ts";
export type { LayoutEdge, LayoutInput };
import { straightenEdges } from "./straighten-edges.ts";

// elkjs exposes a CommonJS constructor with an ESM-shaped declaration file.
const Constructor = ELK as unknown as {
  new (options: ELKConstructorArguments): Engine;
};
const engine = new Constructor({ algorithms: ["layered"] });
const round = (n: number) => Math.round(n * 1000) / 1000;

// One layered layout owns node alignment, port assignment, label placement and
// orthogonal routing. Do not reroute its edges independently of the boxes.
export async function layeredLayout<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
): Promise<LayoutInput<N, E & LayoutEdge>> {
  if (!input.nodes.length) return { nodes: [], edges: [] };
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

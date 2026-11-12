import {
  entersBox,
  type Box,
  type LayoutEdge,
  type LayoutInput,
  type Point,
} from "./graph-routing.ts";

const segments = (points: Point[]) =>
  points.slice(1).map((b, i) => ({ a: points[i], b }));
function touches(a: Point, b: Point, c: Point, d: Point) {
  if (a.x === b.x && c.x !== d.x) return touches(c, d, a, b);
  if (a.y === b.y && c.x === d.x)
    return (
      c.x >= Math.min(a.x, b.x) &&
      c.x <= Math.max(a.x, b.x) &&
      a.y >= Math.min(c.y, d.y) &&
      a.y <= Math.max(c.y, d.y)
    );
  const axis = a.x === b.x ? "y" : "x",
    fixed = axis === "y" ? "x" : "y";
  return (
    a[fixed] === c[fixed] &&
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) >
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) + 0.001
  );
}
const labelBox = (e: LayoutEdge): Box | undefined =>
  e.label
    ? {
        id: e.id,
        x: e.label.x - e.label.width / 2,
        y: e.label.y - e.label.height / 2,
        width: e.label.width,
        height: e.label.height,
      }
    : undefined;
function covers(a: Box, b: Box) {
  return (
    a.x + a.width > b.x &&
    b.x + b.width > a.x &&
    a.y + a.height > b.y &&
    b.y + b.height > a.y
  );
}

// Local edge straightening, not another router: collapse a short terminal step
// only when the continuing channel can move without changing either port.
// This addresses the same terminal-step artifact documented by Mermaid's ELK
// straightenEdges option. The implementation here checks our measured labels,
// nodes and separate connections before accepting a simplification.
export function straightenEdges<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
): LayoutInput<N, E> {
  const edges = input.edges.map((e) => ({
    ...e,
    points: e.points?.map((p) => ({ ...p })),
    label: e.label ? { ...e.label } : undefined,
  }));
  for (const edge of edges)
    for (const reverse of [false, true]) {
      const old = edge.points!;
      const p = reverse ? [...old].reverse() : old;
      if (p.length < 5) continue;
      const [a, b, c, d, e] = p;
      const horizontal = a.y === b.y;
      const axis = horizontal ? "x" : "y",
        fixed = horizontal ? "y" : "x";
      if (b[axis] !== c[axis] || c[fixed] !== d[fixed] || d[axis] !== e[axis])
        continue;
      const delta = a[fixed] - c[fixed];
      if (
        !delta ||
        Math.abs(delta) > 18 ||
        (b[axis] - a[axis]) * (d[axis] - c[axis]) <= 0
      )
        continue;
      const moved = { ...d, [fixed]: a[fixed] };
      if ((e[fixed] - d[fixed]) * (e[fixed] - moved[fixed]) < 0) continue;
      const simplified = [a, moved, ...p.slice(4)];
      const candidate = reverse ? simplified.reverse() : simplified;
      const newSegments = segments(candidate).filter(
        (s) =>
          !segments(old).some(
            (t) =>
              s.a.x === t.a.x &&
              s.a.y === t.a.y &&
              s.b.x === t.b.x &&
              s.b.y === t.b.y,
          ),
      );
      const others = edges.filter((other) => other.id !== edge.id);
      const obstacles = [
        ...input.nodes,
        ...others.flatMap((other) => labelBox(other) ?? []),
      ];
      if (
        newSegments.some((s) =>
          obstacles.some((box) => entersBox(s.a, s.b, box)),
        )
      )
        continue;
      if (
        newSegments.some((s) =>
          others.some((other) =>
            segments(other.points!).some((t) => touches(s.a, s.b, t.a, t.b)),
          ),
        )
      )
        continue;
      let label = edge.label;
      if (
        label &&
        label[axis] >= Math.min(c[axis], d[axis]) &&
        label[axis] <= Math.max(c[axis], d[axis])
      ) {
        label = { ...label, [fixed]: label[fixed] + delta };
        const box = labelBox({ ...edge, label })!;
        if (
          obstacles.some((other) => covers(box, other)) ||
          others.some((other) =>
            segments(other.points!).some((s) => entersBox(s.a, s.b, box)),
          )
        )
          continue;
      }
      edge.points = candidate;
      edge.label = label;
    }
  return { nodes: input.nodes, edges };
}

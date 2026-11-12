export type Point = { x: number; y: number };
export type Box = Point & { id: string; width: number; height: number };
export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  title?: string;
  /** How much the layout should keep this edge pointing forward; a loop back gets none. */
  priority?: number;
  points?: Point[];
  label?: { x: number; y: number; width: number; height: number };
};
export type LayoutInput<
  N extends Box = Box,
  E extends LayoutEdge = LayoutEdge,
> = { nodes: N[]; edges: E[]; direction?: "RIGHT" | "DOWN" };

// Open-rectangle intersection: touching a border is allowed.
export function entersBox(a: Point, b: Point, box: Box): boolean {
  let low = 0,
    high = 1;
  for (const [value, delta, min, max] of [
    [a.x, b.x - a.x, box.x + 0.01, box.x + box.width - 0.01],
    [a.y, b.y - a.y, box.y + 0.01, box.y + box.height - 0.01],
  ]) {
    if (!delta) {
      if (value < min || value > max) return false;
    } else {
      const p = (min - value) / delta,
        q = (max - value) / delta;
      low = Math.max(low, Math.min(p, q));
      high = Math.min(high, Math.max(p, q));
    }
  }
  return low < high;
}
// Preserve the engine geometry without a second routing or curve pass.
export function orthogonalRoute(points: Point[]): string {
  return points
    .map((p, i) => (i ? "L" : "M") + " " + p.x + " " + p.y)
    .join(" ");
}

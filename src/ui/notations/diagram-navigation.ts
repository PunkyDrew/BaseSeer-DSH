import type { Rect } from "./types.ts";

// The moves every picture shares: arrow keys go from the chosen box to the
// nearest box that way, Escape clears the focus before it leaves the level,
// and the minimap shows the whole drawing with the part of it in view.

export type Box = Rect & { id: string };
type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
const directions: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

const centre = (box: Rect) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The box an arrow key moves to: of the boxes whose centre lies that way, the
 * one nearest along the arrow, with sideways distance counting double so the
 * move stays in the row or column it started in. Null when none lies that way.
 */
function boxToward(boxes: readonly Box[], from: string, direction: Direction) {
  const start = boxes.find((b) => b.id === from);
  if (!start) return null;
  const origin = centre(start);
  let best: { id: string; cost: number } | null = null;
  for (const box of boxes) {
    if (box.id === from) continue;
    const point = centre(box);
    const along = {
      ArrowLeft: origin.x - point.x,
      ArrowRight: point.x - origin.x,
      ArrowUp: origin.y - point.y,
      ArrowDown: point.y - origin.y,
    }[direction];
    if (along <= 0) continue;
    const across =
      direction === "ArrowLeft" || direction === "ArrowRight"
        ? Math.abs(point.y - origin.y)
        : Math.abs(point.x - origin.x);
    const cost = along + 2 * across;
    if (!best || cost < best.cost) best = { id: box.id, cost };
  }
  return best?.id ?? null;
}

/** The box an arrow key moves to from the chosen one; null for another key or when none lies that way. */
export function arrowMove(key: string, boxes: readonly Box[], from: string) {
  if (!directions.includes(key)) return null;
  return boxToward(boxes, from, key as Direction);
}

/** Puts the keyboard on a box of the same drawing, which marks itself with data-box. */
export function focusBox(within: Element, id: string) {
  within
    .closest("svg")
    ?.querySelector<SVGElement>(`[data-box="${CSS.escape(id)}"]`)
    ?.focus();
}

/** A box with what it is joined to: the boxes that stay undimmed while it is chosen. */
export function neighbourhood(
  edges: readonly { from: string; to: string }[],
  id: string,
): Set<string> {
  const near = new Set([id]);
  for (const edge of edges) {
    if (edge.from === id) near.add(edge.to);
    if (edge.to === id) near.add(edge.from);
  }
  return near;
}

/** What Escape does: clear the focus first, then go up a level, then nothing. */
export function escapeStep(focused: boolean, level: string): "clear" | "up" | null {
  if (focused) return "clear";
  return level ? "up" : null;
}

/**
 * The minimap's drawing: the whole picture scaled into the map, and the part
 * of it the frame shows, clipped to the picture, in the map's coordinates.
 */
export function minimapView(
  drawing: Rect,
  camera: { x: number; y: number; k: number },
  view: { width: number; height: number },
  map: { width: number; height: number },
) {
  const scale = Math.min(map.width / drawing.width, map.height / drawing.height);
  const left = Math.max(drawing.x, -camera.x / camera.k),
    top = Math.max(drawing.y, -camera.y / camera.k),
    right = Math.min(drawing.x + drawing.width, (view.width - camera.x) / camera.k),
    bottom = Math.min(drawing.y + drawing.height, (view.height - camera.y) / camera.k);
  return {
    scale,
    width: drawing.width * scale,
    height: drawing.height * scale,
    shown: {
      x: (left - drawing.x) * scale,
      y: (top - drawing.y) * scale,
      width: Math.max(0, right - left) * scale,
      height: Math.max(0, bottom - top) * scale,
    },
  };
}

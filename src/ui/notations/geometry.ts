import type { Point, Rect } from "./types.ts";

/** The box around a route, for keeping a selected arrow in view. */
export function pointsBounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** Put fallback labels on a segment, not on an arbitrary bend/endpoint. */
export function routeLabelPoint(points: readonly Point[]): Point | undefined {
  let best: Point | undefined,
    length = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (a.y === b.y && Math.abs(b.x - a.x) > length) {
      length = Math.abs(b.x - a.x);
      best = { x: (a.x + b.x) / 2, y: a.y - 12 };
    }
  }
  return best ?? points[0];
}
export const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
/** Conservative width of 12px text: wide enough for non-Latin glyphs too. */
export const textWidth = (text: string) => text.length * 7;
/** Drawn text has no wrapping of its own: words are broken into lines here, the last one clipped. */
export function wrapText(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length > lines
    ? [...out.slice(0, lines - 1), clip(out.slice(lines - 1).join(" "), width)]
    : out.map((l) => clip(l, width));
}
/** A UML diagram frame's name tag: the pentagon in the frame's top left corner. */
export function frameTag(x: number, y: number, text: string) {
  const width = textWidth(text) + 22,
    height = 24;
  return {
    width,
    height,
    path: `M${x} ${y}H${x + width}V${y + height - 8}L${x + width - 8} ${y + height}H${x}Z`,
  };
}

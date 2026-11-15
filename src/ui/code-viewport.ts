import type { LayoutInput } from "./layered-layout.ts";

// The same opening rule as every other picture (see DiagramFrame): a drawing
// that fits at a readable size opens whole, centred and as large as the frame
// allows; a larger one opens at a readable size on its start box.
const PADDING = 24,
  START_ZOOM = 0.9,
  WIDTH_FLOOR = 0.6;

/** Below this zoom the file names cannot be read. */
export const READABLE = 0.7;

type Box = { x: number; y: number; width: number; height: number };

// React Flow's node-only fit excludes routed bends and connection labels.
// Include those bounds so fitting the overview cannot clip its explanations.
export function codeViewport(
  layout: LayoutInput,
  width: number,
  height: number,
  { always = false, start }: { always?: boolean; start?: Box } = {},
) {
  if (!layout.nodes.length || width <= 2 * PADDING || height <= 2 * PADDING)
    return undefined;
  const boxes = [
    ...layout.nodes,
    ...layout.edges.flatMap((edge) => [
      ...(edge.points ?? []).map((point) => ({
        ...point,
        width: 0,
        height: 0,
      })),
      ...(edge.label
        ? [
            {
              x: edge.label.x - edge.label.width / 2,
              y: edge.label.y - edge.label.height / 2,
              width: edge.label.width,
              height: edge.label.height,
            },
          ]
        : []),
    ]),
  ];
  const left = Math.min(...boxes.map((b) => b.x)),
    top = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.width)) - left,
    h = Math.max(...boxes.map((b) => b.y + b.height)) - top;
  const whole = Math.max(
    0.01,
    Math.min(
      1,
      (width - 2 * PADDING) / Math.max(1, w),
      (height - 2 * PADDING) / Math.max(1, h),
    ),
  );
  if (!always && whole < READABLE) {
    // Too large to read whole: the full width where text stays legible, else centred on the
    // start box (or from the top left).
    const zoom = Math.min(
      START_ZOOM,
      Math.max(WIDTH_FLOOR, (width - 2 * PADDING) / Math.max(1, w)),
    );
    const fitsWidth = w * zoom <= width - 2 * PADDING;
    return {
      x: fitsWidth
        ? (width - w * zoom) / 2 - left * zoom
        : start
          ? width / 2 - (start.x + start.width / 2) * zoom
          : PADDING - left * zoom,
      y: start
        ? height / 2 - (start.y + start.height / 2) * zoom
        : PADDING - top * zoom,
      zoom,
    };
  }
  return {
    x: (width - w * whole) / 2 - left * whole,
    y: (height - h * whole) / 2 - top * whole,
    zoom: whole,
  };
}

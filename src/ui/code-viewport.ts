import type { LayoutInput } from "./layered-layout.ts";

// React Flow's node-only fit excludes routed bends and connection labels.
// Include those bounds so fitting the overview cannot clip its explanations.
export function codeViewport(
  layout: LayoutInput,
  width: number,
  height: number,
) {
  if (!layout.nodes.length || width <= 48 || height <= 48) return undefined;
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
  const zoom = Math.max(
    0.01,
    Math.min(1, (width - 48) / Math.max(1, w), (height - 48) / Math.max(1, h)),
  );
  return {
    x: (width - w * zoom) / 2 - left * zoom,
    y: (height - h * zoom) / 2 - top * zoom,
    zoom,
  };
}

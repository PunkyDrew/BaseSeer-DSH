import React from "react";
import { orthogonalRoute } from "./graph-routing.ts";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

export type RoutePoint = { x: number; y: number };
export function RoutePath({
  id,
  points,
  style,
  markerEnd,
  interactionWidth,
}: {
  id: string;
  points: RoutePoint[];
  style?: React.CSSProperties;
  markerEnd?: string;
  interactionWidth?: number;
}) {
  const path = orthogonalRoute(points);
  return (
    <>
      {/* A crossing gap keeps independent arrows from looking like a junction. */}
      <path
        d={path}
        fill="none"
        stroke="var(--paper)"
        strokeWidth="8"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, strokeLinejoin: "round" }}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
    </>
  );
}
/** The middle of the route's longest straight run, where a name fits best. */
function namePoint(points: RoutePoint[]): RoutePoint {
  let best = points[0],
    length = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    if (run > length) {
      length = run;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}
/** An orthogonal arrow; selected, it also shows the relationship's name. */
export function RoutedEdge({
  id,
  data,
  style,
  markerEnd,
  interactionWidth,
  selected,
}: EdgeProps) {
  const points = data!.points as RoutePoint[];
  const name = data!.name as string | undefined;
  const at = selected && name ? namePoint(points) : null;
  return (
    <>
      <RoutePath
        id={id}
        points={points}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {at && (
        <EdgeLabelRenderer>
          <span
            className="bpg-edge-name"
            style={{
              transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
            }}
          >
            {name}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

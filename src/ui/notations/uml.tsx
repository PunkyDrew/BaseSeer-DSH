import React from "react";
import { NODE_DEPTH } from "./deployment.ts";
import type { Rect } from "./types.ts";

/** The top and side faces that make a UML node a 3D box; its front face is the rect under them, set in by the depth. */
export function UmlNodeFaces({ x, y, width, height }: Rect) {
  const d = NODE_DEPTH;
  return (
    <g className="bpg-uml-faces">
      <path d={`M${x} ${y + d}L${x + d} ${y}H${x + width}L${x + width - d} ${y + d}Z`} />
      <path d={`M${x + width - d} ${y + d}L${x + width} ${y}V${y + height - d}L${x + width - d} ${y + height}Z`} />
    </g>
  );
}

/** A UML diagram frame with its name tag, such as "act Save a note". */
export function UmlFrame({ frame, tag }: { frame: Rect; tag: { text: string; path: string } }) {
  return (
    <g className="bpg-uml-frame">
      <rect {...frame} />
      <path d={tag.path} />
      <text x={frame.x + 8} y={frame.y + 16}>
        {tag.text}
      </text>
    </g>
  );
}

/** A UML note: a rectangle with a folded corner. */
export function UmlNote({ note }: { note: Rect & { title: string; lines: string[] } }) {
  const { x, y, width, height } = note;
  return (
    <g className="bpg-uml-note">
      <path d={`M${x} ${y}H${x + width - 12}L${x + width} ${y + 12}V${y + height}H${x}Z`} />
      <path d={`M${x + width - 12} ${y}V${y + 12}H${x + width}`} />
      <text x={x + 12} y={y + 22} className="bpg-uml-keyword">
        {note.title}
      </text>
      <TextLines x={x + 12} y={y + 42} lines={note.lines} />
    </g>
  );
}

/** Lines of drawn text, one under another. */
export function TextLines({
  x,
  y,
  lines,
  anchor,
  className,
}: {
  x: number;
  y: number;
  lines: string[];
  anchor?: "start" | "middle";
  className?: string;
}) {
  return (
    <text className={className} textAnchor={anchor}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={y + i * 15}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

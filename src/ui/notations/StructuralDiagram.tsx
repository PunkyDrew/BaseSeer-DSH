import React, { useEffect, useId, useMemo, useState } from "react";
import type { GraphItem } from "../graph-model.ts";
import { cardPurpose, fileSummary } from "../graph-card.ts";
import {
  useGraphMeasurements,
  useMeasuredGraphItem,
  type GraphSizes,
  type ReportGraphSize,
} from "../use-graph-measurements.ts";
import type { LevelControls } from "../graph-controls.tsx";
import { DiagramFrame } from "./DiagramFrame.tsx";
import { arrowMove, escapeStep, focusBox } from "./diagram-navigation.ts";
import { NotationEmpty } from "./NotationEmpty.tsx";
import { clip, frameTag, pointsBounds } from "./geometry.ts";
import { structuralLayout, type StructuralLayout } from "./structural-layout.ts";
import { NODE_DEPTH } from "./deployment.ts";
import type { Point, Rect, StructuralNode, StructuralProjection } from "./types.ts";
import { TextLines, UmlFrame, UmlNodeFaces } from "./uml.tsx";

function MeasuredCard({
  id,
  report,
  children,
}: {
  id: string;
  report: ReportGraphSize;
  children: React.ReactNode;
}) {
  const ref = useMeasuredGraphItem<HTMLDivElement>(id, report);
  return (
    <div ref={ref} className="bpg-structural-card">
      {children}
    </div>
  );
}

const routePath = (points: readonly Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
/** The folded-corner outline of a UML comment. */
const commentPath = ({ x, y, width, height }: Rect) =>
  `M${x} ${y}H${x + width - 12}L${x + width} ${y + 12}V${y + height}H${x}Z M${x + width - 12} ${y}V${y + 12}H${x + width}`;

/** What a box says, in UML's format: its stereotype and name, then compartments for its purpose and planned files, or a class's attributes (an empty compartment when it has none); a comment its words alone. A node keeps its technology line even when it holds other boxes. */
function Card({ node }: { node: StructuralNode }) {
  if (node.symbol === "comment")
    return (
      <>
        <span className="bpg-kind">{node.typeLine}</span>
        <strong>{node.title}</strong>
        {node.summary && <p>{node.summary}</p>}
      </>
    );
  return (
    <>
      <div className="bpg-uml-name">
        {node.typeLine && <span className="bpg-kind">{node.typeLine}</span>}
        <strong>{node.title}</strong>
      </div>
      {node.symbol === "class" ? (
        <ul className="bpg-uml-compartment bpg-uml-attributes">
          {node.attributes.map((attribute) => (
            <li key={attribute}>{attribute}</li>
          ))}
        </ul>
      ) : (
        (!node.boundary || node.symbol === "node") &&
        node.summary && <p className="bpg-uml-compartment">{cardPurpose(node.summary)}</p>
      )}
      {!node.boundary && !!node.files.length && (
        <p className="bpg-uml-compartment bpg-files">«artifacts» {fileSummary(node.files)}</p>
      )}
      {node.folded && (
        <span className="bpg-holds">
          holds {node.folded} {node.folded === 1 ? "part" : "parts"}
        </span>
      )}
    </>
  );
}

// How each relationship is drawn: a dependency or an information flow dashed
// with an open head, a realization with a hollow triangle, a comment's anchor
// with no head, a composition solid with a filled diamond at the owner, a
// communication path solid and bare.
const strokes: Record<string, { dash?: string; start?: string; end?: string }> = {
  anchor: { dash: "4 3" },
  implements: { dash: "7 5", end: "realize" },
  owns: { start: "diamond" },
  path: {},
};
const strokeOf = (type: string) => strokes[type] ?? { dash: "7 5", end: "open" };

export function StructuralDiagram({
  project,
  signature,
  kind,
  heading,
  selected,
  onSelect,
  onFallback,
  fallback,
  legend,
  inset,
  title,
  levels,
  onOpen,
}: {
  /** The projection for measured box sizes; called again when a box's size changes. */
  project: (sizes: GraphSizes) => StructuralProjection;
  /** Changes whenever the projection's input does. */
  signature: string;
  /** The diagram's kind, as UML abbreviates it in the frame's tag: component, class or deployment. */
  kind: "cmp" | "class" | "dep";
  /** The name in the UML frame's tag. */
  heading: string;
  selected: string;
  onSelect: (item: GraphItem | null) => void;
  onFallback: () => void;
  fallback: string;
  legend: React.ReactNode;
  inset?: number;
  title: string;
  /** The level drawn, for a diagram opened level by level. */
  levels?: LevelControls;
  /** Opens a closed container's own diagram. */
  onOpen?: (id: string) => void;
}) {
  const id = useId().replaceAll(":", "");
  const { sizes, report } = useGraphMeasurements();
  const projection = useMemo(() => project(sizes), [signature, sizes]);
  const [layout, setLayout] = useState<{
    key: typeof projection;
    value?: StructuralLayout;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    structuralLayout(projection).then(
      (value) => live && setLayout({ key: projection, value }),
      (error) =>
        live &&
        setLayout({ key: projection, error: String(error?.message ?? error) }),
    );
    return () => {
      live = false;
    };
  }, [projection]);
  const current = layout?.key === projection ? layout : null;
  const [hovered, setHovered] = useState("");
  const items = [...projection.nodes, ...projection.edges];
  const focus = items.some((i) => i.id === selected) ? selected : hovered;
  const near = new Set<string>();
  for (const e of projection.edges)
    if ([e.id, e.from, e.to].includes(focus))
      for (const x of [e.id, e.from, e.to]) near.add(x);
  const classes = (target: string, base: string) =>
    `${base}${target === selected ? " is-selected" : near.has(target) ? " is-near" : ""}`;
  const choose = (target: string) =>
    onSelect(
      target === selected
        ? null
        : (items.find((i) => i.id === target) ?? null),
    );
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const closed = (target: string) => !!byId.get(target)?.folded && !!onOpen;
  // Enter opens a closed container, and shows anything else's details.
  const enter = (target: string) => {
    if (closed(target)) return onOpen!(target);
    if (target !== selected) choose(target);
  };
  const selectProps = (target: string) => ({
    role: "button",
    tabIndex: 0,
    "aria-pressed": target === selected,
    onClick: () => choose(target),
    onDoubleClick: () => closed(target) && onOpen!(target),
    onPointerEnter: () => setHovered(target),
    onPointerLeave: () => setHovered(""),
    onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.key === "Enter") enter(target);
        else choose(target);
        return;
      }
      const next = arrowMove(event.key, boxes, target);
      if (!next) return;
      event.preventDefault();
      focusBox(event.currentTarget, next);
      choose(next);
    },
  });
  const depth = (nodeId: string) => {
    let d = 0;
    for (let p = byId.get(nodeId)?.parent; p; p = byId.get(p)?.parent) d++;
    return d;
  };
  // Outer boundaries first so nested boxes paint over them.
  const ordered = [...projection.nodes].sort(
    (a, b) =>
      depth(a.id) - depth(b.id) || Number(b.boundary) - Number(a.boundary),
  );
  if (!projection.nodes.length)
    return (
      <NotationEmpty reason={projection.empty} label={fallback} onFallback={onFallback} />
    );
  if (current?.error)
    return (
      <p role="alert" className="bpv-error bpg-alert">
        {current.error}
      </p>
    );
  if (!current?.value)
    return (
      <div className="bpg-loading" role="status">
        Arranging diagram…
      </div>
    );
  const value = current.value;
  const route = value.routes.get(selected);
  // The boxes the keys move between and the minimap draws: everything but
  // the open container's frame.
  const boxes = ordered
    .filter((n) => !n.boundary)
    .map((n) => ({ ...value.boxes.get(n.id)!, id: n.id }));
  const level = levels?.path.at(-1)?.id ?? "";
  const escape = () => {
    const step = escapeStep(!!selected, level);
    if (step === "clear") onSelect(null);
    if (step === "up") levels!.onLevel(levels!.path.at(-2)?.id ?? "");
  };
  // UML draws the diagram in a frame named by its tag.
  const box = value.viewBox;
  const tag = frameTag(box.x - 8, box.y - 36, `${kind} ${clip(heading, 70)}`);
  const frame = { x: box.x - 8, y: box.y - 36, width: Math.max(box.width + 16, tag.width + 24), height: box.height + 44 };
  const viewBox = { x: frame.x - 16, y: frame.y - 16, width: frame.width + 32, height: frame.height + 32 };
  return (
    <>
      <p id={`${id}-meaning`} hidden>
        {projection.note}
      </p>
      <DiagramFrame
        viewBox={viewBox}
        label={`${heading} diagram`}
        describedBy={`${id}-meaning`}
        svgLabel={heading}
        legend={legend}
        notes={projection.warnings}
        selected={value.boxes.get(selected) ?? (route && pointsBounds(route))}
        start={[...boxes].sort((a, b) => a.y - b.y || a.x - b.x)[0]}
        inset={inset}
        title={title}
        outline={boxes}
        levels={levels}
        onEscape={escape}
        onClear={() => selected && onSelect(null)}
      >
        <defs>
          <marker id={`${id}-open`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </marker>
          <marker id={`${id}-realize`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path d="M1 1L11 6L1 11Z" style={{ fill: "var(--paper)" }} stroke="currentColor" strokeWidth="1.2" />
          </marker>
          <marker id={`${id}-diamond`} viewBox="0 0 14 10" refX="1" refY="5" markerWidth="14" markerHeight="10" orient="auto">
            <path d="M1 5L7 1L13 5L7 9Z" style={{ fill: "currentColor" }} stroke="currentColor" strokeWidth="1" />
          </marker>
        </defs>
        <UmlFrame frame={frame} tag={{ text: `${kind} ${clip(heading, 70)}`, path: tag.path }} />
        {ordered.map((n) => {
          const b = value.boxes.get(n.id)!;
          // A node's front face stands in from its top and side faces.
          const d = n.symbol === "node" ? NODE_DEPTH : 0;
          const face = { x: b.x, y: b.y + d, width: b.width - d, height: b.height - d };
          return (
            <g
              key={n.id}
              {...selectProps(n.id)}
              data-box={n.id}
              data-folded={n.folded || undefined}
              data-symbol={n.symbol}
              data-kind={n.symbol === "comment" ? n.kind : undefined}
              data-external={n.external || undefined}
              data-boundary={n.boundary || undefined}
              aria-label={`${n.typeLine} ${n.title}.${n.status ? ` ${n.status}.` : ""}${n.folded ? ` Holds ${n.folded} parts; Enter opens it.` : ""}`}
              className={classes(n.id, "bpg-structural-node")}
            >
              {n.symbol === "comment" ? (
                <path className="bpg-uml-comment" d={commentPath(b)} />
              ) : (
                <rect {...face} rx={2} />
              )}
              {n.symbol === "node" && <UmlNodeFaces {...b} />}
              {n.symbol === "component" && (
                <g className="bpg-uml-icon" transform={`translate(${b.x + b.width - 24} ${b.y + 8})`}>
                  <rect x="4" y="0" width="12" height="15" />
                  <rect x="0" y="3" width="8" height="3" />
                  <rect x="0" y="9" width="8" height="3" />
                </g>
              )}
              <foreignObject
                {...face}
                height={n.boundary ? (sizes[n.id]?.height ?? n.height - d) : face.height}
              >
                <MeasuredCard id={n.id} report={report}>
                  <Card node={n} />
                </MeasuredCard>
              </foreignObject>
              <title>{`${n.title}\n${n.typeLine} · ${n.status}\n${n.summary}`}</title>
            </g>
          );
        })}
        {projection.edges.map((e) => {
          const points = value.routes.get(e.id);
          if (!points) return null;
          const label = value.labels.get(e.id);
          const stroke = strokeOf(e.type);
          return (
            <g
              key={e.id}
              {...selectProps(e.id)}
              data-type={e.type}
              aria-label={`${byId.get(e.from)?.title} ${e.title} ${byId.get(e.to)?.title}${e.label.length ? `: ${e.label.join(" ")}` : ""}`}
              className={classes(e.id, "bpg-seq-message bpg-structural-edge")}
            >
              <path
                d={routePath(points)}
                markerStart={stroke.start ? `url(#${id}-${stroke.start})` : undefined}
                markerEnd={stroke.end ? `url(#${id}-${stroke.end})` : undefined}
                strokeDasharray={stroke.dash}
              />
              <path d={routePath(points)} className="bpg-seq-hit" />
              {label && (
                <TextLines className="bpg-seq-label" x={label.x} y={label.y} lines={e.label} anchor="middle" />
              )}
              <title>{e.summary}</title>
            </g>
          );
        })}
      </DiagramFrame>
    </>
  );
}

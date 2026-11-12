import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  getViewportForBounds,
  type ReactFlowInstance,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import flowStyles from "@xyflow/react/dist/base.css";
import type { Document, PlanningRecord } from "../domain/records.ts";
import {
  projectGraphRecords,
  type GraphItem,
  type GraphEdge,
  type GraphView,
} from "./graph-model.ts";
import { graphStyles } from "./graph-styles.ts";
import { useGraphLayout } from "./use-graph-layout.ts";
import { RoutedEdge } from "./routed-edge.tsx";
import { edgePresentation, nodeColor } from "./graph-presentation.ts";
import { GraphLegend } from "./graph-legend.tsx";
import { GraphControls } from "./graph-controls.tsx";
import { usePhoneInput } from "./use-phone-input.ts";
import { useGraphTap } from "./use-graph-tap.ts";
import { recordMeaning } from "./view-meaning.ts";
import {
  useGraphMeasurements,
  useMeasuredGraphItem,
  type ReportGraphSize,
} from "./use-graph-measurements.ts";
import {
  cameraLayoutSignature,
  usableGraphCamera,
  type GraphNavigation,
} from "./workspace-contract.ts";
import { cardPurpose } from "./graph-card.ts";

function RecordNode({ data }: NodeProps) {
  const item = data.item as GraphItem;
  const ref = useMeasuredGraphItem<HTMLDivElement>(
    item.id,
    data.reportSize as ReportGraphSize,
  );
  return (
    <div
      ref={ref}
      className="bpg-node"
      data-kind={item.kind.toLowerCase()}
      title={`${item.title}\n${recordMeaning[item.kind] ?? item.kind}\n${item.summary}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <strong>{item.title}</strong>
      {!data.hideTaskType && (
        <span className="bpg-kind">
          {item.kind === "task"
            ? "Implementation task"
            : item.kind.charAt(0).toUpperCase() + item.kind.slice(1)}
        </span>
      )}
      <p className="bpg-purpose">{cardPurpose(item.summary)}</p>
      {!!data.status && (
        <span className="bpg-status">{data.status as string}</span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { record: RecordNode };

const edgeTypes = { routed: RoutedEdge };
const titles: Record<GraphView, string> = {
  Work: "Follow-up work",
  Review: "Checks",
};

// The plan's own graphs, drawn with React Flow: the folded follow-up work and
// review graphs. The standard notations draw themselves.
export function PlanGraph({
  document: doc,
  view,
  selected,
  onSelect,
  status,
  navigation,
  onNavigation,
  inset = 0,
  title = titles[view],
}: {
  document: Document;
  view: GraphView;
  selected: string;
  onSelect: (item: GraphItem | null) => void;
  status: (record: PlanningRecord) => string;
  navigation?: GraphNavigation;
  onNavigation?: (value: GraphNavigation) => void;
  /** Pixels at the canvas's bottom that a sheet covers; the selection is kept above them. */
  inset?: number;
  /** The drawing's name, in the bar under it. */
  title?: string;
}) {
  const phone = usePhoneInput();
  const { sizes, report: reportSize } = useGraphMeasurements();
  const signature = JSON.stringify(doc);
  const projection = useMemo(
    () => projectGraphRecords(doc, view, sizes),
    [signature, view, sizes],
  );
  const arrangement = useGraphLayout(projection);
  const diagram = useMemo(
    () => ({ ...projection, ...arrangement.layout }),
    [projection, arrangement.layout],
  );
  const layoutSignature = useMemo(
    () => cameraLayoutSignature(diagram.nodes),
    [diagram],
  );
  // What the selection, or the box under the pointer, touches stays vivid;
  // the rest steps back.
  const [hovered, setHovered] = useState("");
  const focus = selected || hovered;
  const near = useMemo(() => {
    const ids = new Set<string>();
    if (!focus) return ids;
    for (const e of diagram.edges)
      if (e.id === focus || e.from === focus || e.to === focus) {
        ids.add(e.id);
        ids.add(e.from);
        ids.add(e.to);
      }
    ids.add(focus);
    return ids;
  }, [diagram, focus]);
  const dim = (id: string) => (focus && !near.has(id) ? "bpg-dim" : "");
  const nodes = useMemo<Node[]>(
    () =>
      diagram.nodes.map((n) => ({
        id: n.id,
        type: "record",
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        // Keep React Flow's measured handles across polling/selection updates.
        // Omitting measured resets its internals even when box size is stable.
        measured: sizes[n.id],
        className: dim(n.id),
        data: {
          item: n,
          hideTaskType: diagram.nodes.every((node) => node.kind === "task"),
          reportSize,
          status: doc.records.find((r) => r.id === (n.basis ?? n.record))
            ? status(doc.records.find((r) => r.id === (n.basis ?? n.record))!)
            : "Planned",
        },
        selected: selected === n.id,
        ariaLabel: `${n.kind}: ${n.title}`,
        draggable: false,
      })),
    [diagram, selected, near, status, signature],
  );
  const edges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((e) => ({
          id: e.id,
          source: e.from,
          target: e.to,
          type: "routed",
          className: focus && near.has(e.id) ? "bpg-near" : dim(e.id),
          data: {
            item: e,
            points: e.points,
            name: edgePresentation(e.type).label,
            reportSize,
            onSelect,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgePresentation(e.type).color,
            width: 20,
            height: 20,
          },
          selected: selected === e.id,
          interactionWidth: 28,
          focusable: true,
          ariaLabel: `${diagram.nodes.find((n) => n.id === e.from)?.title} ${e.title} ${diagram.nodes.find((n) => n.id === e.to)?.title}`,
          style: {
            strokeWidth: 2,
            stroke: edgePresentation(e.type).color,
            strokeDasharray: edgePresentation(e.type).dash,
          },
        })),
    [diagram, selected, near, view, onSelect, reportSize],
  );
  const tap = useGraphTap(phone, (id) => {
    const item = [...diagram.nodes, ...diagram.edges].find(
      (item) => item.id === id,
    );
    if (item) onSelect(item);
  });
  // The camera: a saved one is kept while the layout it was saved for holds;
  // otherwise the whole picture is fitted, or, when that would be too small to
  // read, its top left corner at a readable size.
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance | null>(null);
  const savedViewport = useRef(navigation?.viewport);
  const placed = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fit = (always = false) => {
    const el = container.current;
    if (!el?.clientWidth || !el.clientHeight || !instance.current || !diagram.nodes.length)
      return;
    const boxes = [
      ...diagram.nodes,
      ...diagram.edges.flatMap((e) =>
        e.label
          ? [{ ...e.label, x: e.label.x - e.label.width / 2, y: e.label.y - e.label.height / 2 }]
          : [],
      ),
    ];
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    const bounds = {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
    // The title block takes the canvas's bottom; the drawing fits above it.
    const height =
      el.clientHeight -
      (el.querySelector<HTMLElement>(".bpg-controls")?.offsetHeight ?? 0);
    let viewport = getViewportForBounds(
      bounds,
      el.clientWidth,
      height,
      0.05,
      1,
      0.08,
    );
    if (!always && viewport.zoom < 0.5)
      viewport = { zoom: 0.8, x: 24 - bounds.x * 0.8, y: 24 - bounds.y * 0.8 };
    void instance.current.setViewport(viewport);
  };
  const place = () => {
    const el = container.current;
    if (
      !el?.clientWidth ||
      !el.clientHeight ||
      !instance.current ||
      !arrangement.ready ||
      !diagram.nodes.length
    )
      return;
    placed.current = true;
    const camera = savedViewport.current;
    if (
      camera &&
      usableGraphCamera(camera, diagram.nodes, el.clientWidth, el.clientHeight, layoutSignature)
    )
      void instance.current.setViewport(camera);
    else fit();
  };
  useEffect(place, [arrangement.ready, layoutSignature, size.width > 0]);
  useEffect(() => {
    // A selection made elsewhere, or one a sheet now covers, is brought into
    // the part of the canvas that stays visible, at the zoom it is at.
    const el = container.current;
    if (!placed.current || !el || !instance.current || !selected) return;
    const node = diagram.nodes.find((n) => n.id === selected);
    const edge = diagram.edges.find((e) => e.id === selected);
    const points = edge?.points ?? [];
    const box = node
      ? node
      : edge?.label
        ? { ...edge.label, x: edge.label.x - edge.label.width / 2, y: edge.label.y - edge.label.height / 2 }
        : points.length
          ? {
              x: Math.min(...points.map((p) => p.x)),
              y: Math.min(...points.map((p) => p.y)),
              width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
              height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
            }
          : undefined;
    if (!box) return;
    const { x, y, zoom } = instance.current.getViewport();
    const width = el.clientWidth,
      height =
        el.clientHeight -
        Math.max(inset, el.querySelector<HTMLElement>(".bpg-controls")?.offsetHeight ?? 0);
    const left = box.x * zoom + x,
      top = box.y * zoom + y;
    if (
      left >= 0 &&
      top >= 0 &&
      left + box.width * zoom <= width &&
      top + box.height * zoom <= height
    )
      return;
    void instance.current.setViewport(
      {
        zoom,
        x: width / 2 - (box.x + box.width / 2) * zoom,
        y: height / 2 - (box.y + box.height / 2) * zoom,
      },
      { duration: 200 },
    );
  }, [selected, inset, arrangement.ready]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const remember = () => {
    const viewport = instance.current?.getViewport();
    if (!viewport) return;
    savedViewport.current = { ...viewport, layoutSignature };
    onNavigation?.({ viewport: savedViewport.current });
  };
  const flowReady = !arrangement.error && arrangement.ready && nodes.length > 0;
  useEffect(() => {
    if (selected && arrangement.ready)
      onSelect(
        [...diagram.nodes, ...diagram.edges].find(
          (item) => item.id === selected,
        ) ?? null,
      );
  }, [diagram]);
  const legend = (
    <>
      {flowReady && (
        <GraphLegend
          kinds={diagram.nodes.map((n) => n.kind)}
          types={edges.map((e) => (e.data!.item as GraphEdge).type)}
        />
      )}
      <p>{diagram.note}</p>
      <p className="bpv-muted">
        {phone
          ? "Drag to move around and pinch to zoom."
          : "Scroll to zoom and drag the background to move around."}{" "}
        Select a box or arrow for its details. Colours tell kinds apart; they
        do not mean right or wrong.
      </p>
    </>
  );
  return (
    <section
      className="bpg"
      data-phone={phone || undefined}
      aria-label={`${view} graph`}
    >
      <style>
        {flowStyles}
        {graphStyles}
      </style>
      {arrangement.error ? (
        <p role="alert" className="bpv-error bpg-alert">
          {arrangement.error}{" "}
          <button onClick={arrangement.retry}>Retry layout</button>
        </p>
      ) : !arrangement.ready && projection.nodes.length ? (
        <div className="bpg-loading" role="status">
          Arranging diagram…
        </div>
      ) : !nodes.length ? (
        <div className="bpg-empty" role="status">
          <p>
            {view === "Review"
              ? "No evidence or findings are recorded yet."
              : "No follow-up work is recorded yet."}
          </p>
        </div>
      ) : (
        <div
          ref={container}
          className="bpg-canvas"
          data-testid={`${view.toLowerCase()}-graph`}
          {...tap}
          onKeyDownCapture={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const id = (event.target as Element)
              .closest(".react-flow__node,.react-flow__edge")
              ?.getAttribute("data-id");
            const item = [...diagram.nodes, ...diagram.edges].find(
              (n) => n.id === id,
            );
            if (item) {
              event.preventDefault();
              onSelect(item);
            }
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            proOptions={{ hideAttribution: true }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(i) => {
              instance.current = i;
              place();
            }}
            onMoveEnd={(event) => {
              if (event) remember();
            }}
            minZoom={0.05}
            maxZoom={1.8}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            zoomOnScroll={!phone}
            zoomOnDoubleClick={false}
            autoPanOnNodeFocus={!phone}
            zoomOnPinch
            panOnDrag
            preventScrolling={!phone}
            onNodeClick={(_, n) => onSelect(n.data.item as GraphItem)}
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered("")}
            onEdgeClick={(_, e) => onSelect(e.data!.item as GraphItem)}
            onPaneClick={() => onSelect(null)}
          >
            {size.height >= 360 && size.width >= 560 && (
              <MiniMap
                position="bottom-left"
                style={{ width: 120, height: 76 }}
                pannable
                zoomable
                nodeColor={(node) =>
                  nodeColor((node.data.item as GraphItem).kind)
                }
                ariaLabel="Graph overview: drag to navigate"
              />
            )}
          </ReactFlow>
          <GraphControls
            onZoomIn={() => void instance.current?.zoomIn().then(remember)}
            onZoomOut={() => void instance.current?.zoomOut().then(remember)}
            onFit={() => {
              fit(true);
              remember();
            }}
            legend={legend}
            title={title}
          />
        </div>
      )}
    </section>
  );
}

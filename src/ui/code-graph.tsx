import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  EdgeLabelRenderer,
  type EdgeProps,
  type ReactFlowInstance,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import { RoutedEdge, RoutePath } from "./routed-edge.tsx";
import type { ConnectionGroup } from "./connection-groups.ts";
import { codeViewport } from "./code-viewport.ts";
import type { LayoutEdge } from "./layered-layout.ts";
import { edgePresentation } from "./graph-presentation.ts";
import { GraphLegend } from "./graph-legend.tsx";
import { GraphControls } from "./graph-controls.tsx";
import { useGraphLayout } from "./use-graph-layout.ts";
import flowStyles from "@xyflow/react/dist/base.css";
import { graphStyles } from "./graph-styles.ts";
import { usePhoneInput } from "./use-phone-input.ts";
import { useGraphTap } from "./use-graph-tap.ts";
import type { CodeFile, CodeSnapshot } from "../contracts/code.ts";
import { projectCodeGraph, type ProjectedFile } from "./code-projection.ts";
import {
  useGraphMeasurements,
  useMeasuredGraphItem,
  type ReportGraphSize,
} from "./use-graph-measurements.ts";

function FileNode({ data }: NodeProps) {
  const file = data.file as ProjectedFile;
  const ref = useMeasuredGraphItem<HTMLDivElement>(
    file.path,
    data.reportSize as ReportGraphSize,
  );
  return (
    <div
      ref={ref}
      className={`bpg-node bpc-node${data.compact ? " bpc-summary" : ""}`}
      data-coverage={file.coverage}
      title={file.path}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <strong>
        {file.group
          ? file.group.path.split("/").at(-1) + "/"
          : file.path.split("/").at(-1)}
      </strong>
      <span className="bpg-kind">
        {file.language} ·{" "}
        {file.group
          ? `${file.group.count} inspected files`
          : file.coverage === "syntax"
            ? "Syntax inspected"
            : file.coverage === "parse-error"
              ? "Parse errors"
              : "Source only"}
      </span>
      {!data.compact && (
        <p>
          {file.group?.path ?? file.path}
          <br />
          {file.group
            ? `${file.group.internalImports} imports inside this folder · Open to explore`
            : `${file.declarations.length} declarations · ${file.lines} lines`}
        </p>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { file: FileNode };
function ConnectionEdge({
  id,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const item = data!.item as LayoutEdge;
  const connection = data!.connection as ConnectionGroup;
  const ref = useMeasuredGraphItem<HTMLButtonElement>(
    id,
    data!.reportSize as ReportGraphSize,
  );
  return (
    <>
      <RoutePath
        id={id}
        points={item.points!}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      <EdgeLabelRenderer>
        <button
          ref={ref}
          className="bpg-edge-label nodrag nopan"
          aria-label={`Connection: ${connection.label} (${connection.basis})`}
          style={{
            transform: `translate(-50%, -50%) translate(${item.label!.x}px, ${item.label!.y}px)`,
          }}
          onClick={() =>
            (data!.onConnection as (c: ConnectionGroup) => void)(connection)
          }
        >
          {connection.label}
          {connection.basis === "inferred" && (
            <>
              <br />
              Inferred
            </>
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const codeEdgeTypes = { routed: RoutedEdge, connection: ConnectionEdge };
export function CodeGraph({
  snapshot,
  selected,
  folder,
  dependencies,
  onSelect,
  navigation,
  onNavigation,
  grouped = false,
  onFolder,
  relationshipConnections,
  onConnection,
}: {
  snapshot: CodeSnapshot;
  selected: string;
  folder: string;
  dependencies: boolean;
  onSelect: (path: string) => void;
  navigation?: any;
  onNavigation?: (value: any) => void;
  grouped?: boolean;
  onFolder?: (folder: string) => void;
  relationshipConnections?: ConnectionGroup[];
  onConnection?: (connection: ConnectionGroup) => void;
}) {
  const phone = usePhoneInput();
  const { sizes, report: reportSize } = useGraphMeasurements();
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A narrow canvas reads better with the chain running downwards.
  const direction: "DOWN" | "RIGHT" =
    size.width && size.width < 600 ? "DOWN" : "RIGHT";
  const instance = useRef<ReactFlowInstance | null>(null);
  const savedViewport = useRef(navigation?.viewport);
  const fitting = useRef(!navigation?.viewport);
  const rememberViewport = () => {
    const viewport = instance.current?.getViewport();
    if (viewport) {
      savedViewport.current = viewport;
      onNavigation?.({ viewport });
    }
  };
  const navigate = async (action: () => Promise<boolean> | undefined) => {
    await action();
    rememberViewport();
  };
  const select = (id: string) => {
    if (phone) rememberViewport();
    const group = files.find((f) => f.path === id)?.group;
    if (group) onFolder?.(group.path);
    else onSelect(id);
  };
  const fit = () => {
    fitting.current = true;
    const viewport =
      relationshipConnections &&
      container.current &&
      codeViewport(
        {
          nodes: graph.nodes.map((node) => ({
            id: node.id,
            ...node.position,
            width: node.measured?.width ?? 190,
            height: node.measured?.height ?? 132,
          })),
          edges: arrangement.layout.edges,
        },
        container.current.clientWidth,
        container.current.clientHeight,
      );
    return viewport
      ? instance.current?.setViewport(viewport)
      : instance.current?.fitView({
          padding: 0.15,
          minZoom: 0.01,
          maxZoom: 1,
        });
  };
  const projection = useMemo(
    () => projectCodeGraph(snapshot, folder, grouped),
    [snapshot, folder, grouped],
  );
  const files = projection.files;
  const connections = useMemo(() => {
    const names = new Set(files.map((f) => f.path));
    if (relationshipConnections)
      return relationshipConnections.map((c) => ({
        id: c.id,
        from: c.from,
        to: c.to,
      }));
    return files.flatMap((f) =>
      f.imports
        .filter((i) => i.target && names.has(i.target))
        .map((i, index) => ({
          id: `${f.path}:${i.line}:${index}`,
          from: f.path,
          to: i.target!,
        })),
    );
  }, [snapshot.digest, folder, relationshipConnections]);
  const layoutInput = useMemo(
    () => ({
      direction: relationshipConnections ? direction : undefined,
      nodes: files.map((f) => ({
        id: f.path,
        x: 0,
        y: 0,
        ...(sizes[f.path] ?? { width: 238, height: 132 }),
      })),
      edges: connections.map((c) => {
        const relation = relationshipConnections?.find((r) => r.id === c.id);
        return relation
          ? {
              ...c,
              title: relation.label,
              label: {
                x: 0,
                y: 0,
                ...(sizes[c.id] ?? {
                  width: Math.min(220, relation.label.length * 7 + 24),
                  height: relation.basis === "inferred" ? 58 : 40,
                }),
              },
            }
          : c;
      }),
    }),
    [
      snapshot.digest,
      folder,
      sizes,
      connections,
      relationshipConnections,
      direction,
    ],
  );
  const arrangement = useGraphLayout(layoutInput);
  const graph = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const names = new Set(files.map((f) => f.path));
    const arrangedNodes = new Map(
      arrangement.layout.nodes.map((n) => [n.id, n]),
    );
    const routes = new Map(
      arrangement.layout.edges.map((e) => [e.id, e.points]),
    );
    const edges: Edge[] = relationshipConnections
      ? relationshipConnections.map((c) => ({
          id: c.id,
          type: "connection",
          source: c.from,
          target: c.to,
          ariaLabel: `${c.from} → ${c.to}: ${c.label} (${c.basis})`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgePresentation(c.basis === "inferred" ? "type" : "value")
              .color,
          },
          interactionWidth: 28,
          style: {
            strokeWidth: 2,
            stroke: edgePresentation(c.basis === "inferred" ? "type" : "value")
              .color,
            strokeDasharray: c.basis === "inferred" ? "7 5" : undefined,
          },
          data: {
            item: arrangement.layout.edges.find((e) => e.id === c.id),
            connection: c,
            reportSize,
            onConnection,
          },
        }))
      : files.flatMap((f) =>
          f.imports
            .filter((i) => i.target && names.has(i.target))
            .map((i, index) => {
              const id = `${f.path}:${i.line}:${index}`;
              return {
                id,
                type: "routed",
                source: f.path,
                target: i.target!,
                ariaLabel: `${f.path} imports ${i.target} at line ${i.line} (${i.kind})`,
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: edgePresentation(i.kind).color,
                },
                interactionWidth: 28,
                style: {
                  strokeWidth: 2,
                  stroke: edgePresentation(i.kind).color,
                  strokeDasharray: edgePresentation(i.kind).dash,
                },
                data: {
                  path: f.path,
                  points: routes.get(id),
                  name: edgePresentation(i.kind).label,
                },
              };
            }),
        );
    const actualNodes: Node[] = files
      .filter((f) => arrangedNodes.has(f.path))
      .map((f) => ({
        id: f.path,
        type: "file",
        measured: sizes[f.path],
        position: {
          x: arrangedNodes.get(f.path)!.x,
          y: arrangedNodes.get(f.path)!.y,
        },
        data: { file: f, reportSize, compact: !!relationshipConnections },
        selected: f.path === selected,
        ariaLabel: f.group
          ? `Source folder: ${f.group.path}; ${f.group.count} files`
          : `Source file: ${f.path}`,
        draggable: false,
      }));
    return {
      nodes: actualNodes,
      edges: arrangement.ready ? edges : [],
    };
  }, [
    snapshot.digest,
    folder,
    selected,
    sizes,
    reportSize,
    arrangement.layout,
    arrangement.ready,
    relationshipConnections,
    onConnection,
  ]);
  const primary =
    files.find((f) => f.path === selected) ??
    [...files].sort((a, b) => {
      const score = (f: CodeFile) =>
        (/([/.]|^)(test|tests|spec)([/.]|$)/i.test(f.path) ? -100 : 0) +
        f.imports.length;
      return score(b) - score(a);
    })[0];
  const tap = useGraphTap(phone, (id) => {
    const file = files.find((file) => file.path === id);
    const edge = graph.edges.find((edge) => edge.id === id);
    if (edge && relationshipConnections)
      onConnection?.(relationshipConnections.find((c) => c.id === edge.id)!);
    else if (file || edge) select(file?.path ?? edge!.source);
  });
  const focusSelection = () => {
    fitting.current = false;
    return primary
      ? instance.current?.fitView({
          nodes: [{ id: primary.path }],
          padding: 0.25,
          minZoom: 0.9,
          maxZoom: 1,
        })
      : fit();
  };
  const restoreOrFit = () =>
    relationshipConnections && fitting.current
      ? fit()
      : savedViewport.current
        ? void instance.current?.setViewport(savedViewport.current)
        : relationshipConnections
          ? fit()
          : focusSelection();
  const previousFocus = useRef({ selected, folder });
  useEffect(() => {
    const moved =
      (!phone && previousFocus.current.selected !== selected) ||
      previousFocus.current.folder !== folder;
    previousFocus.current = { selected, folder };
    if (moved) savedViewport.current = undefined;
    const frame = requestAnimationFrame(() => {
      if (moved) void navigate(relationshipConnections ? fit : focusSelection);
      else restoreOrFit();
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.digest, folder, selected, phone, arrangement.layout]);
  const legend = (
    <>
      {!relationshipConnections && (
        <GraphLegend
          kinds={["Source file"]}
          types={
            dependencies
              ? files.flatMap((f) =>
                  f.imports
                    .filter(
                      (i) =>
                        i.target &&
                        files.some((target) => target.path === i.target),
                    )
                    .map((i) => i.kind),
                )
              : []
          }
        />
      )}
      <p>
        {relationshipConnections
          ? "Solid arrows group observed imports and static references between files; dashed arrows are separate inferred explanations. Arrows show the stated direction of each relationship, not a verified execution sequence. Select an arrow to see the individual names, source locations and evidence."
          : "Arrows point to imported files. Dashed arrows mark type-only or dynamic imports; imports do not establish execution order."}
        {files.some((f) => f.group) &&
          " Folder boxes group actual files; select a folder to drill down. Arrows summarize observed imports between the displayed groups; folders are not architectural claims."}
      </p>
      <p className="bpv-muted">
        {phone
          ? "Drag to move around and pinch to zoom."
          : "Scroll to zoom and drag the background to move around."}{" "}
        Select a file to inspect its source.
      </p>
    </>
  );
  return (
    <section className="bpg" aria-label="Actual code graph">
      <style>
        {flowStyles}
        {graphStyles}
        {`.bpg .bpc-summary { width:190px; min-height:0; padding:10px 12px; } .bpg .bpc-summary .bpg-kind { margin-bottom:0; } .bpc-graph-status { margin:0 0 8px; }`}
      </style>
      <p className="bpv-muted bpc-graph-status" role="status">
        {files.length} boxes · {projection.total} files · {connections.length}{" "}
        {relationshipConnections
          ? `connections · ${relationshipConnections.reduce((n, c) => n + c.items.length, 0)} references`
          : "visible import links"}
        {!dependencies && " (hidden)"}
        {projection.omitted > 0 &&
          ` · the first 80 boxes are shown; ${projection.omitted} more are reachable through Browse files and the folder filters`}
      </p>
      {arrangement.error ? (
        <p role="alert" className="bpv-error bpg-alert">
          {arrangement.error}{" "}
          <button onClick={arrangement.retry}>Retry layout</button>
        </p>
      ) : !arrangement.ready && files.length ? (
        <div className="bpg-loading" role="status">
          Arranging diagram…
        </div>
      ) : null}
      <div
        ref={container}
        className="bpg-canvas"
        data-testid="code-graph"
        {...tap}
        onKeyDownCapture={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          const target = (event.target as Element)
            .closest(".react-flow__node,.react-flow__edge")
            ?.getAttribute("data-id");
          const file = files.find((f) => f.path === target);
          const edge = graph.edges.find((e) => e.id === target);
          if (file || edge) {
            event.preventDefault();
            if (edge && relationshipConnections)
              onConnection?.(
                relationshipConnections.find((c) => c.id === edge.id)!,
              );
            else select(file?.path ?? edge!.source);
          }
        }}
      >
        <ReactFlow
          nodes={graph.nodes}
          edges={dependencies ? graph.edges : []}
          proOptions={{ hideAttribution: true }}
          nodeTypes={nodeTypes}
          edgeTypes={codeEdgeTypes}
          onInit={(i) => {
            instance.current = i;
            restoreOrFit();
          }}
          defaultViewport={navigation?.viewport}
          onMove={(event, viewport) => {
            if (event) {
              fitting.current = false;
              savedViewport.current = viewport;
            }
          }}
          onMoveStart={(event, viewport) => {
            if (phone && event) savedViewport.current = viewport;
          }}
          onMoveEnd={(event, viewport) => {
            if (event) {
              savedViewport.current = viewport;
              onNavigation?.({ viewport });
            }
          }}
          minZoom={0.01}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          zoomOnScroll={!phone}
          zoomOnDoubleClick={false}
          autoPanOnNodeFocus={!phone}
          preventScrolling={!phone}
          onNodeClick={(_, n) => select(n.id)}
          onEdgeClick={(_, e) =>
            relationshipConnections
              ? onConnection?.(
                  relationshipConnections.find((c) => c.id === e.id)!,
                )
              : select(e.source)
          }
        >
          {size.height >= 360 && size.width >= 560 && (
            <MiniMap
              position="bottom-left"
              style={{ width: 120, height: 76 }}
              pannable
              zoomable
              nodeColor="var(--tone-ink)"
              ariaLabel="Code overview: drag to navigate"
            />
          )}
        </ReactFlow>
        <GraphControls
          onZoomIn={() => {
            fitting.current = false;
            void navigate(() => instance.current?.zoomIn());
          }}
          onZoomOut={() => {
            fitting.current = false;
            void navigate(() => instance.current?.zoomOut());
          }}
          onFit={() => void navigate(fit)}
          legend={legend}
          title="Code map"
        />
      </div>
    </section>
  );
}

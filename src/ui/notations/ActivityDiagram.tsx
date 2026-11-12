import React, { useId, useMemo } from "react";
import type { Document, PlanningRecord } from "../../domain/records.ts";
import type { GraphItem } from "../graph-model.ts";
import { partColor } from "../graph-presentation.ts";
import { DiagramFrame } from "./DiagramFrame.tsx";
import { activityLayout, type ActivityNode } from "./activity.ts";
import { pointsBounds } from "./geometry.ts";
import { scenarioItem, scenarioModel } from "./scenario.ts";
import type { Point, Rect } from "./types.ts";
import { TextLines, UmlFrame, UmlNote } from "./uml.tsx";

const path = (points: readonly Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

/** Lines centred in a box, an action's outcome lettered lighter under its name. */
function Lines({ node, lines, sub = [] }: { node: Rect; lines: string[]; sub?: string[] }) {
  const x = node.x + node.width / 2,
    y = node.y + node.height / 2 - ((lines.length + sub.length - 1) * 15) / 2 + 4;
  return (
    <>
      <TextLines x={x} y={y} lines={lines} anchor="middle" />
      {sub.length > 0 && (
        <TextLines className="bpg-act-outcome" x={x} y={y + lines.length * 15} lines={sub} anchor="middle" />
      )}
    </>
  );
}

function Shape({ node }: { node: ActivityNode }) {
  const cx = node.x + node.width / 2,
    cy = node.y + node.height / 2;
  switch (node.kind) {
    case "initial":
      return <circle className="bpg-act-solid" cx={cx} cy={cy} r={node.width / 2} />;
    case "final":
      return (
        <>
          <circle className="bpg-act-ring" cx={cx} cy={cy} r={node.width / 2} />
          <circle className="bpg-act-solid" cx={cx} cy={cy} r={node.width / 2 - 5} />
        </>
      );
    case "decision":
    case "merge":
      return (
        <path
          className="bpg-act-diamond"
          d={`M${cx} ${node.y}L${node.x + node.width} ${cy}L${cx} ${node.y + node.height}L${node.x} ${cy}Z`}
        />
      );
    case "accept":
      return (
        <>
          <path
            className="bpg-act-box"
            d={`M${node.x} ${node.y}H${node.x + node.width}V${node.y + node.height}H${node.x}L${node.x + 14} ${cy}Z`}
          />
          <Lines node={{ ...node, x: node.x + 8, width: node.width - 8 }} lines={node.lines} />
        </>
      );
    case "action":
      return (
        <>
          <rect className="bpg-act-box" x={node.x} y={node.y} width={node.width} height={node.height} rx="12" />
          <Lines node={node} lines={node.lines} sub={node.sub} />
        </>
      );
  }
}

export function ActivityDiagram({
  document: doc,
  scenario,
  focus,
  selected,
  onSelect,
  legend,
  inset,
  title,
}: {
  document: Document;
  scenario: PlanningRecord;
  /** Parts whose lanes are drawn forward: the part the owner opened, and the parts inside it. */
  focus: ReadonlySet<string>;
  selected: string;
  onSelect: (item: GraphItem | null) => void;
  legend: React.ReactNode;
  inset?: number;
  title: string;
}) {
  const id = useId().replaceAll(":", "");
  const signature = JSON.stringify(doc);
  const model = useMemo(() => scenarioModel(scenario), [signature, scenario.id]);
  const name = (part: string) =>
    doc.records.find((r) => r.id === part)?.title ?? `Unknown part ${part}`;
  const layout = useMemo(() => activityLayout(model, name), [model]);
  const record = (part: string) => doc.records.find((r) => r.id === part);
  // A lane, and the steps in it, take the hue of their part.
  const hue = (part: string) =>
    ({ "--k": partColor(doc, part) }) as React.CSSProperties;
  const choose = (key: string) => {
    if (key === selected) return onSelect(null);
    const lane = layout.lanes.find((l) => `lane:${l.part}` === key);
    const part = lane && record(lane.part);
    onSelect(
      part
        ? { id: part.id, record: part.id, title: part.title, kind: part.kind, summary: part.data.responsibility ?? "" }
        : scenarioItem(model, key),
    );
  };
  const selectProps = (key: string, label: string) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": key === selected,
    onClick: () => choose(key),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose(key);
      }
    },
  });
  const chosenNode = layout.nodes.find((n) => n.step === selected);
  const chosenEdge = layout.edges.find((e) => e.id === selected);
  const near = new Set<string>();
  if (chosenNode || chosenEdge)
    for (const t of model.transitions)
      if (t.key === selected || model.steps.some((s) => s.key === selected && (s.id === t.from || s.id === t.to)))
        for (const x of [t.key, ...model.steps.filter((s) => s.id === t.from || s.id === t.to).map((s) => s.key)])
          near.add(x);
  const state = (key: string) =>
    key === selected ? " is-selected" : near.has(key) ? " is-near" : "";
  const marker = `${id}-arrow`;
  // The opened part's first step stays in view above a phone's sheet; its
  // lane's header is pinned with the others.
  const opened = layout.lanes.find((l) => l.part && focus.has(l.part));
  const firstStep = opened && layout.nodes.find((n) => n.kind === "action" && layout.lanes[n.lane] === opened);
  const headers = layout.lanes.map((lane) => (
    <g
      key={lane.part || "-"}
      className={`bpg-act-lane${focus.has(lane.part) ? " is-focus" : ""}${state(`lane:${lane.part}`)}`}
      style={hue(lane.part)}
      {...(lane.part ? selectProps(`lane:${lane.part}`, `Part ${lane.lines.join(" ")}`) : {})}
    >
      <rect className="bpg-act-lane-head" x={lane.x} y={layout.laneTop} width={lane.width} height={layout.headerHeight} />
      <Lines node={{ x: lane.x, y: layout.laneTop, width: lane.width, height: layout.headerHeight }} lines={lane.lines} />
    </g>
  ));
  return (
    <>
      <p id={`${id}-meaning`} hidden>
        UML activity diagram of {scenario.title}: one partition per part, read
        from the initial node down to the final node. Each action carries its
        outcome under its name. Diamonds are decisions, each way out guarded
        by its condition in square brackets, and merges.
      </p>
      <DiagramFrame
        viewBox={layout.viewBox}
        label="Activity diagram"
        describedBy={`${id}-meaning`}
        svgLabel={`Activity of ${scenario.title}`}
        legend={legend}
        notes={model.warnings}
        selected={chosenNode ?? (chosenEdge && pointsBounds(chosenEdge.points))}
        reveal={firstStep}
        opening={layout.frame}
        pinned={{ top: layout.laneTop, content: headers }}
        inset={inset}
        title={title}
      >
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </marker>
        </defs>
        <UmlFrame frame={layout.frame} tag={layout.tag} />
        {layout.lanes.map((lane) => (
          <g key={lane.part || "-"} className="bpg-act-lane" style={hue(lane.part)}>
            <rect x={lane.x} y={layout.laneTop} width={lane.width} height={layout.laneBottom - layout.laneTop} />
          </g>
        ))}
        {layout.notes.map((n) => (
          <UmlNote key={n.title} note={n} />
        ))}
        {layout.edges.map((e) => (
          <g
            key={e.id}
            className={`bpg-act-flow${e.transition ? state(e.id) : ""}`}
            data-kind={e.transition?.kind}
            {...(e.transition
              ? selectProps(e.id, `${e.transition.back ? "Repeat" : "Flow"}${e.transition.condition ? ` when ${e.transition.condition}` : ""}`)
              : {})}
          >
            <path d={path(e.points)} markerEnd={`url(#${marker})`} />
            {e.transition && <path d={path(e.points)} className="bpg-seq-hit" />}
            {e.label && <TextLines className="bpg-seq-label" {...e.label} />}
          </g>
        ))}
        {layout.nodes.map((n) => {
          const step = model.steps.find((s) => s.key === n.step);
          return (
            <g
              key={n.id}
              className={`bpg-act-node${step && focus.has(step.part) ? " is-focus" : ""}${n.step ? state(n.step) : ""}`}
              style={step && hue(step.part)}
              data-kind={n.kind}
              {...(n.step ? selectProps(n.step, `Step: ${step!.action}`) : {})}
            >
              <Shape node={n} />
              {step && <title>{[step.action, step.outcome].filter(Boolean).join("\n")}</title>}
            </g>
          );
        })}
      </DiagramFrame>
    </>
  );
}

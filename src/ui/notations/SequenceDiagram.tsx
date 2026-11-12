import React, { useId, useMemo } from "react";
import type { Document, PlanningRecord } from "../../domain/records.ts";
import type { GraphItem } from "../graph-model.ts";
import { partColor } from "../graph-presentation.ts";
import { DiagramFrame } from "./DiagramFrame.tsx";
import { frameTag, pointsBounds } from "./geometry.ts";
import { scenarioItem, scenarioModel } from "./scenario.ts";
import { sequenceLayout } from "./sequence.ts";
import type { Point } from "./types.ts";
import { TextLines, UmlFrame, UmlNote } from "./uml.tsx";

const path = (points: readonly Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

export function SequenceDiagram({
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
  /** Parts whose lifelines are drawn forward. */
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
  const layout = useMemo(() => sequenceLayout(model, name), [model]);
  // A lifeline, and the part's turns at work on it, take the hue of their part.
  const hue = (part: string) =>
    ({ "--k": partColor(doc, part) }) as React.CSSProperties;
  const arrowItem = (key: string): GraphItem | null => {
    const a = layout.arrows.find((x) => x.id === key);
    if (!a) return null;
    const item = a.transition ? scenarioItem(model, a.transition) : null;
    if (!a.message) return item;
    const m = a.message;
    const meaning =
      m.kind === "synchronous"
        ? "Synchronous message: the sender waits for the receiver."
        : m.kind === "asynchronous"
          ? "Asynchronous message: the sender continues without waiting."
          : "Reply: returns to the sender of an earlier message.";
    return {
      ...(item ?? { id: key, record: scenario.id, basis: scenario.id, kind: "", summary: "" }),
      id: key,
      title: m.label,
      kind: `Message · ${m.kind}`,
      supportTargets: [`messages.${m.id}.label`, ...(m.guard ? [`messages.${m.id}.guard`] : [])],
      details: [{ label: "Meaning", text: meaning }, ...(item?.details ?? [])],
    };
  };
  const choose = (key: string) => {
    if (key === selected) return onSelect(null);
    const part = doc.records.find((r) => `life:${r.id}` === key);
    onSelect(
      part
        ? { id: part.id, record: part.id, title: part.title, kind: part.kind, summary: part.data.responsibility ?? "" }
        : (arrowItem(key) ?? scenarioItem(model, key)),
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
  const execution = layout.executions.find((e) => e.step === selected);
  const chosenArrow = layout.arrows.find((a) => a.id === selected);
  const near = new Set<string>();
  const stepOf = (key: string) => model.steps.find((s) => s.key === key);
  for (const t of model.transitions) {
    const ends = model.steps.filter((s) => s.id === t.from || s.id === t.to).map((s) => s.key);
    if (t.key === selected || ends.includes(selected)) [t.key, ...ends].forEach((x) => near.add(x));
  }
  const state = (key: string) =>
    key === selected ? " is-selected" : near.has(key) ? " is-near" : "";
  const sync = `${id}-sync`,
    open = `${id}-open`;
  return (
    <>
      <p id={`${id}-meaning`} hidden>
        UML sequence diagram of {scenario.title}: one lifeline per part, read
        top to bottom. A filled arrow is a call to the part that does the next
        step, named after that step; a dashed arrow is a reply, carrying the
        outcome. Frames marked alt, break and loop hold the steps that run only
        under the condition in square brackets.
      </p>
      <DiagramFrame
        viewBox={layout.viewBox}
        label="Sequence diagram"
        describedBy={`${id}-meaning`}
        svgLabel={`Sequence of ${scenario.title}`}
        legend={legend}
        notes={model.warnings}
        selected={execution ?? (chosenArrow && pointsBounds(chosenArrow.points))}
        reveal={layout.lifelines.find((l) => l.part && focus.has(l.part))?.head}
        opening={layout.frame}
        inset={inset}
        title={title}
      >
        <defs>
          <marker id={open} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </marker>
          <marker id={sync} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" style={{ fill: "currentColor" }} stroke="none" />
          </marker>
        </defs>
        <UmlFrame frame={layout.frame} tag={layout.tag} />
        {layout.fragments.map((f, i) => {
          const tag = frameTag(f.x, f.y, f.operator);
          return (
            <g key={i} className="bpg-uml-fragment">
              <rect x={f.x} y={f.y} width={f.width} height={f.height} />
              <path d={tag.path} />
              <text className="bpg-uml-keyword" x={f.x + 8} y={f.y + 16}>
                {f.operator}
              </text>
              {f.operands.map((o, j) => (
                <g key={j}>
                  {j > 0 && <line x1={f.x} x2={f.x + f.width} y1={o.y} y2={o.y} strokeDasharray="6 4" />}
                  {o.guard && (
                    <text className="bpg-seq-label" x={f.x + (j ? 10 : tag.width + 8)} y={o.y + 17}>
                      {o.guard}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}
        {layout.lifelines.map((l) => (
          <g
            key={l.part || "-"}
            className={`bpg-seq-lifeline${focus.has(l.part) ? " is-focus" : ""}${state(`life:${l.part}`)}`}
            style={hue(l.part)}
            {...(l.part ? selectProps(`life:${l.part}`, `Lifeline ${l.lines.join(" ")}`) : {})}
          >
            <rect {...l.head} />
            <TextLines
              x={l.x}
              y={l.head.y + l.head.height / 2 + 5 - ((l.lines.length - 1) * 15) / 2}
              lines={l.lines}
              anchor="middle"
            />
            <line x1={l.x} x2={l.x} y1={l.head.y + l.head.height} y2={layout.bottom} strokeDasharray="6 5" />
          </g>
        ))}
        {layout.executions.map((e) => {
          const step = stepOf(e.step)!;
          return (
            <g
              key={e.step}
              className={`bpg-seq-event${focus.has(step.part) ? " is-focus" : ""}${state(e.step)}`}
              style={hue(step.part)}
              {...selectProps(e.step, `Step: ${step.action}`)}
            >
              <rect x={e.x} y={e.y} width={e.width} height={e.height} />
              <rect className="bpg-seq-hit" x={e.x - 8} y={e.y} width={e.width + 16} height={e.height} />
              <title>{[step.action, step.outcome].filter(Boolean).join("\n")}</title>
            </g>
          );
        })}
        {layout.arrows.map((a) => (
          <g
            key={a.id}
            className={`bpg-seq-message${state(a.id)}`}
            data-kind={a.message ? a.message.kind : a.tone}
            {...selectProps(a.id, `Message: ${a.label.lines.join(" ")}`)}
          >
            {a.kind === "found" && <circle cx={a.points[0].x} cy={a.points[0].y} r="5" style={{ fill: "currentColor" }} />}
            <path
              d={path(a.points)}
              markerEnd={`url(#${a.kind === "synchronous" ? sync : open})`}
              strokeDasharray={a.kind === "reply" ? "6 4" : undefined}
            />
            <path d={path(a.points)} className="bpg-seq-hit" />
            <TextLines className="bpg-seq-label" {...a.label} />
          </g>
        ))}
        {layout.notes.map((n) => (
          <UmlNote key={n.title} note={n} />
        ))}
      </DiagramFrame>
    </>
  );
}

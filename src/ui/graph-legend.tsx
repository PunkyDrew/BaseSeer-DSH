import React, { useEffect, useId, useRef, useState } from "react";
import { edgePresentation, nodeColor } from "./graph-presentation.ts";
import { elementExplanation, relationshipExplanation } from "./graph-terms.ts";

type Help = {
  key: string;
  label: string;
  explanation: string;
  source: "hover" | "focus" | "tap";
  left: number;
  top: number;
};
/** The kinds of box and arrow a diagram shows, each explained on hover, focus or tap. */
export function GraphLegend({
  kinds,
  types,
}: {
  kinds: string[];
  types: string[];
}) {
  const legend = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [help, setHelp] = useState<Help | null>(null);
  useEffect(() => {
    if (!help) return;
    const outside = (event: PointerEvent) => {
      if (!legend.current?.contains(event.target as Node)) setHelp(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelp(null);
    };
    const resize = () => setHelp(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [Boolean(help)]);
  const open = (
    button: HTMLButtonElement,
    key: string,
    label: string,
    explanation: string,
    source: Help["source"],
  ) => {
    const box = button.getBoundingClientRect(),
      parent = legend.current!.getBoundingClientRect();
    setHelp({
      key,
      label,
      explanation,
      source,
      left: Math.max(
        0,
        Math.min(
          box.left - parent.left,
          parent.width - Math.min(300, parent.width),
        ),
      ),
      top: box.bottom - parent.top,
    });
  };
  const entry = (
    key: string,
    label: string,
    explanation: string,
    swatch: React.ReactNode,
  ) => (
    <button
      key={key}
      type="button"
      className="bpg-term"
      aria-describedby={help?.key === key ? tooltipId : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse")
          open(event.currentTarget, key, label, explanation, "hover");
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible"))
          open(event.currentTarget, key, label, explanation, "focus");
      }}
      onClick={(event) => {
        if (help?.key === key && help.source === "tap") setHelp(null);
        else open(event.currentTarget, key, label, explanation, "tap");
      }}
    >
      {swatch}
      <span>{label}</span>
    </button>
  );
  return (
    <div
      ref={legend}
      className="bpg-key"
      aria-label="Diagram legend"
      onPointerLeave={() =>
        setHelp((current) => (current?.source === "hover" ? null : current))
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setHelp((current) => (current?.source === "hover" ? current : null));
      }}
    >
      <div>
        <strong>Boxes</strong>
        {[...new Set(kinds)].map((kind) =>
          entry(
            `node:${kind}`,
            kind,
            elementExplanation(kind),
            <i
              aria-hidden="true"
              className="bpg-key-box"
              style={
                {
                  "--k": nodeColor(kind),
                  borderStyle:
                    kind === "interface" ? "dashed" : kind === "mapping" ? "dotted" : "solid",
                } as React.CSSProperties
              }
            />,
          ),
        )}
      </div>
      <div>
        <strong>Arrows</strong>
        {[...new Set(types)].map((type) => {
          const value = edgePresentation(type);
          return entry(
            `edge:${type}`,
            value.label,
            relationshipExplanation(type),
            <svg width="34" height="14" aria-hidden="true">
              <path
                d="M 1 7 L 28 7"
                stroke={value.color}
                strokeWidth="2"
                strokeDasharray={value.dash}
              />
              <path
                d="M 26 3 L 32 7 L 26 11"
                fill="none"
                stroke={value.color}
                strokeWidth="2"
              />
            </svg>,
          );
        })}
      </div>
      <p>Tap a label for its meaning. Crossing lines do not connect.</p>
      {help && (
        <aside
          id={tooltipId}
          role="tooltip"
          className="bpg-term-help"
          style={{ left: help.left, top: help.top }}
        >
          <strong>{help.label}</strong>
          <p>{help.explanation}</p>
        </aside>
      )}
    </div>
  );
}

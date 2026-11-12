import React, { useEffect, useId, useRef, useState } from "react";

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const icons = {
  fit: icon("M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"),
  out: icon("M3 8h10"),
  in: icon("M3 8h10M8 3v10"),
};

/** The bar under a drawing: its name, zoom and fit, the key and the notes. */
export function GraphControls({
  onZoomIn,
  onZoomOut,
  onFit,
  legend,
  notes = [],
  title,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  legend: React.ReactNode;
  notes?: string[];
  title: string;
}) {
  const [open, setOpen] = useState<"" | "key" | "notes">("");
  const id = useId().replaceAll(":", "");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen("");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen("");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const toggle = (name: "key" | "notes") =>
    setOpen((value) => (value === name ? "" : name));
  return (
    <div
      ref={root}
      className="bpg-controls nopan nowheel"
      role="group"
      aria-label="Diagram controls"
    >
      {open === "key" && (
        <div
          id={`${id}-key`}
          className="bpg-pop"
          role="group"
          aria-label="How to read this diagram"
        >
          {legend}
        </div>
      )}
      {open === "notes" && (
        <div
          id={`${id}-notes`}
          className="bpg-pop"
          role="group"
          aria-label="Notes about this view"
        >
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      <span className="bpg-controls-title" title={title}>
        {title}
      </span>
      <button aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
        {icons.out}
      </button>
      <button aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
        {icons.in}
      </button>
      <button aria-label="Fit the whole diagram" title="Fit" onClick={onFit}>
        {icons.fit}
      </button>
      <button
        aria-expanded={open === "key"}
        aria-controls={`${id}-key`}
        aria-label="How to read this diagram"
        title="Key"
        onClick={() => toggle("key")}
      >
        Key
      </button>
      {notes.length > 0 && (
        <button
          aria-expanded={open === "notes"}
          aria-controls={`${id}-notes`}
          aria-label={`${notes.length} notes about this view`}
          title="Notes about this view"
          onClick={() => toggle("notes")}
        >
          Notes {notes.length}
        </button>
      )}
    </div>
  );
}

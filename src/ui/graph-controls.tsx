import React, { useEffect, useId, useRef, useState } from "react";
import type { LevelPath } from "./notations/levels.ts";

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const icons = {
  fit: icon("M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"),
  out: icon("M3 8h10"),
  in: icon("M3 8h10M8 3v10"),
  find: icon("M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.5 10.5L14 14"),
};

/** A part a search found, with where it sits so two of the same name tell apart. */
export type FoundPart = { id: string; title: string; where: string };

/**
 * How a picture drawn level by level is moved through: the path of the level
 * shown (empty at the top), going to a level, and finding a part at any level.
 */
export type LevelControls = {
  path: LevelPath;
  onLevel: (level: string) => void;
  find: (query: string) => FoundPart[];
  onFind: (id: string) => void;
  /** What a box is called in this picture: a part, or on the Code map a file. */
  noun?: string;
};

/** The way up from the level shown: the picture's name, then each container opened. */
function Breadcrumb({ title, levels }: { title: string; levels: LevelControls }) {
  const steps = [{ id: "", title }, ...levels.path];
  return (
    <nav className="bpg-crumbs" aria-label="Level">
      <ol>
        {steps.map((step, index) => (
          <li key={step.id || "top"}>
            {index === steps.length - 1 ? (
              <span aria-current="location" title={step.title}>
                {step.title}
              </span>
            ) : (
              <button title={step.title} onClick={() => levels.onLevel(step.id)}>
                {step.title}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Finds a part by name: no match says so, and same-named parts are told apart by where they sit. */
function FindPart({ levels, onDone }: { levels: LevelControls; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const found = levels.find(query);
  const noun = levels.noun ?? "part";
  const pick = (id: string) => {
    levels.onFind(id);
    onDone();
  };
  return (
    <>
      <label className="bpg-find">
        <span>Find a {noun}</span>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && found[0]) pick(found[0].id);
          }}
        />
      </label>
      {query.trim() && !found.length && (
        <p role="status">
          No {noun} matches “{query.trim()}”.
        </p>
      )}
      {found.length > 0 && (
        <ul className="bpg-found" aria-label="Matches">
          {found.map((part) => (
            <li key={part.id}>
              <button onClick={() => pick(part.id)}>
                <strong>{part.title}</strong>
                <span>{part.where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The bar under a drawing: its name or the level shown, finding a part, zoom and fit, the key and the notes. */
export function GraphControls({
  onZoomIn,
  onZoomOut,
  onFit,
  legend,
  notes = [],
  title,
  levels,
  map,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  legend: React.ReactNode;
  notes?: string[];
  title: string;
  levels?: LevelControls;
  /** Showing and hiding the minimap, where the drawing has one. */
  map?: { shown: boolean; onToggle: () => void };
}) {
  const [open, setOpen] = useState<"" | "key" | "notes" | "find">("");
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
  const find = `Find a ${levels?.noun ?? "part"}`;
  const toggle = (name: "key" | "notes" | "find") =>
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
      {open === "find" && levels && (
        <div
          id={`${id}-find`}
          className="bpg-pop"
          role="group"
          aria-label={find}
        >
          <FindPart levels={levels} onDone={() => setOpen("")} />
        </div>
      )}
      {levels?.path.length ? (
        <Breadcrumb title={title} levels={levels} />
      ) : (
        <span className="bpg-controls-title" title={title}>
          {title}
        </span>
      )}
      {levels && (
        <button
          aria-expanded={open === "find"}
          aria-controls={`${id}-find`}
          aria-label={find}
          title={find}
          onClick={() => toggle("find")}
        >
          {icons.find}
        </button>
      )}
      <button aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
        {icons.out}
      </button>
      <button aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
        {icons.in}
      </button>
      <button aria-label="Fit the whole diagram" title="Fit" onClick={onFit}>
        {icons.fit}
      </button>
      {map && (
        <button
          className="bpg-map-toggle"
          aria-pressed={map.shown}
          aria-label="Minimap"
          title="Minimap of the whole diagram"
          onClick={map.onToggle}
        >
          Map
        </button>
      )}
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

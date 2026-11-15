import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GraphControls, type LevelControls } from "../graph-controls.tsx";
import { usePhoneInput } from "../use-phone-input.ts";
import { minimapView } from "./diagram-navigation.ts";
import type { Rect } from "./types.ts";

type Camera = { x: number; y: number; k: number };
const MIN_ZOOM = 0.1,
  MAX_ZOOM = 2.5,
  PADDING = 24;
/** Below this the labels cannot be read; a drawing that would fit only smaller opens, and fits, as wide as reads. */
const READABLE = 0.7;

// The frame of a notation drawing: the drawing is panned by dragging, zoomed
// with the wheel, a pinch, the keyboard or the controls, and placed whenever
// its geometry changes, so a drawing of any size opens readable and, when
// that is possible, whole.
export function DiagramFrame({
  viewBox,
  label,
  describedBy,
  svgLabel,
  legend,
  notes,
  selected,
  reveal,
  pinned,
  start,
  opening,
  inset = 0,
  title,
  outline = [],
  levels,
  onEscape,
  onClear,
  children,
}: {
  viewBox: Rect;
  label: string;
  describedBy: string;
  svgLabel: string;
  legend: React.ReactNode;
  notes?: string[];
  /** The selected element, in drawing coordinates; the frame keeps it in view and dims the rest. */
  selected?: Rect;
  /** What the owner opened the drawing for (a part's lane or lifeline): kept in view like a selection, without dimming the rest. */
  reveal?: Rect;
  /** A header row of the drawing, from its top edge in drawing coordinates, held at the frame's top when panned past it. */
  pinned?: { top: number; content: React.ReactNode };
  /** What a drawing too large to read whole opens on, across: its top row. */
  start?: Rect;
  /** What the drawing opens on when it fits readably: the drawing without what stands beside it (notes), which Fit includes. */
  opening?: Rect;
  /** Pixels at the frame's bottom that a sheet covers; the selection is kept above them. */
  inset?: number;
  /** The drawing's name, in the bar under it. */
  title: string;
  /** The boxes the minimap draws; a drawing without them has no minimap. */
  outline?: Rect[];
  /** The level shown and finding a part, for a drawing opened level by level. */
  levels?: LevelControls;
  /** Escape anywhere in the drawing: clear its focus, else go up a level. */
  onEscape?: () => void;
  /** A click or tap on the drawing's empty space, which is not the end of a drag. */
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [view, setView] = useState({ width: 0, height: 0 });
  const phone = usePhoneInput();
  const placed = useRef(false);
  placed.current = camera !== null;
  const [dragging, setDragging] = useState(false);
  // The minimap would cover part of the drawing it maps, so it shows when asked for.
  const [mapShown, setMapShown] = useState(false);
  const hasMap = outline.length > 0 && !phone;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  // The bar of controls takes the frame's bottom; the drawing area is what it leaves.
  const strip = (el: HTMLElement) =>
    el.querySelector<HTMLElement>(".bpg-controls")?.offsetHeight ?? 0;
  const fit = (always = false) => {
    const el = frame.current;
    if (!el?.clientWidth || !el.clientHeight) return;
    const height = el.clientHeight - strip(el);
    const target = (!always && opening) || viewBox;
    const whole = Math.min(
      (el.clientWidth - 2 * PADDING) / target.width,
      (height - 2 * PADDING) / target.height,
      1,
    );
    if (whole >= READABLE) {
      setCamera({
        k: whole,
        x: (el.clientWidth - target.width * whole) / 2 - target.x * whole,
        y: (height - target.height * whole) / 2 - target.y * whole,
      });
      return;
    }
    // Too large to read whole, Fit included: shrinking it further would only
    // make it unreadable, so it is shown as wide as reads, from its top edge,
    // and the rest is scrolled to, as a page is.
    const across = (el.clientWidth - 2 * PADDING) / viewBox.width;
    const k = Math.min(1, Math.max(READABLE, across));
    setCamera({
      k,
      x: placeAcross(el.clientWidth, k),
      y: PADDING - viewBox.y * k,
    });
  };
  // Centred when the drawing's width fits; otherwise on its start (centred,
  // or from its left end when it is wider than the view), never past the
  // drawing's own edges, so the view opens on content rather than margin.
  const placeAcross = (width: number, k: number) => {
    if (viewBox.width * k <= width - 2 * PADDING)
      return (width - viewBox.width * k) / 2 - viewBox.x * k;
    const left = PADDING - viewBox.x * k,
      right = width - PADDING - (viewBox.x + viewBox.width) * k;
    if (!start) return left;
    const onStart =
      start.width * k <= width - 2 * PADDING
        ? width / 2 - (start.x + start.width / 2) * k
        : PADDING - start.x * k;
    return Math.min(left, Math.max(right, onStart));
  };
  // The drawing's bounds, by value: a drawing redrawn as it was keeps its camera.
  const bounds = [viewBox.x, viewBox.y, viewBox.width, viewBox.height];
  // A level opened or left with the keys redraws without the box the keyboard
  // was on; the keyboard stays in the frame rather than falling to the page.
  const keyed = useRef(false);
  useLayoutEffect(() => {
    fit();
    if (keyed.current && document.activeElement === document.body) frame.current?.focus();
    keyed.current = false;
  }, bounds);
  useLayoutEffect(() => {
    // A selection made elsewhere, or one a sheet now covers, is brought into
    // the part of the frame that stays visible, at the zoom it is at. It
    // updates the camera rather than replacing it, so a drawing placed in the
    // same commit (a level just opened) is the one it moves.
    const el = frame.current,
      target = selected ?? reveal;
    if (!target || !el || !camera) return;
    setCamera((c) => {
      if (!c) return c;
      const width = el.clientWidth,
        height = el.clientHeight - Math.max(inset, strip(el));
      const left = target.x * c.k + c.x,
        top = target.y * c.k + c.y,
        right = left + target.width * c.k,
        bottom = top + target.height * c.k;
      if (left >= 0 && top >= 0 && right <= width && bottom <= height) return c;
      return {
        k: c.k,
        x: width / 2 - (target.x + target.width / 2) * c.k,
        y:
          target.height * c.k > height - 2 * PADDING
            ? height - PADDING - (target.y + target.height) * c.k
            : height / 2 - (target.y + target.height / 2) * c.k,
      };
    });
  }, [
    ...[selected ?? reveal].flatMap((t) => [t?.x, t?.y, t?.width, t?.height]),
    inset,
    camera !== null,
  ]);
  const zoomBy = (factor: number, cx?: number, cy?: number) =>
    setCamera((c) => {
      const el = frame.current;
      if (!c || !el) return c;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.k * factor));
      const px = cx ?? el.clientWidth / 2,
        py = cy ?? (el.clientHeight - strip(el)) / 2;
      return { k, x: px - (px - c.x) * (k / c.k), y: py - (py - c.y) * (k / c.k) };
    });
  const panBy = (dx: number, dy: number) =>
    setCamera((c) => (c ? { ...c, x: c.x + dx, y: c.y + dy } : c));
  const centreOn = (x: number, y: number) =>
    setCamera((c) => {
      const el = frame.current;
      if (!c || !el) return c;
      return { k: c.k, x: el.clientWidth / 2 - x * c.k, y: (el.clientHeight - strip(el)) / 2 - y * c.k };
    });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // A wheel over the drawing zooms it instead of scrolling the page, which
    // needs a listener React would register as passive.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left,
        event.clientY - box.top,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    // A frame that had no size when the drawing arrived fits it once it has one.
    const observer = new ResizeObserver(() => {
      setView({ width: el.clientWidth, height: el.clientHeight - strip(el) });
      if (!placed.current) fit();
    });
    observer.observe(el);
    return () => {
      el.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, bounds);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);
    const others = [...pointers.current].filter(([id]) => id !== event.pointerId);
    if (others.length) {
      // Two contacts: scale around their midpoint by how far they spread.
      const [, other] = others[0];
      const spread = Math.hypot(now.x - other.x, now.y - other.y),
        wasSpread = Math.hypot(before.x - other.x, before.y - other.y);
      const box = event.currentTarget.getBoundingClientRect();
      if (wasSpread > 0)
        zoomBy(
          spread / wasSpread,
          (now.x + other.x) / 2 - box.left,
          (now.y + other.y) / 2 - box.top,
        );
      moved.current = true;
      return;
    }
    const dx = now.x - before.x,
      dy = now.y - before.y;
    if (!dx && !dy) return;
    panBy(dx, dy);
    // Capturing only once this is a drag leaves a plain click to the element
    // under the pointer.
    if (!moved.current && Math.hypot(dx, dy) > 3) {
      moved.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) setDragging(false);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape from anywhere in the drawing clears its focus or goes up; the
    // bar's own popovers close on it themselves.
    keyed.current = event.key === "Enter" || event.key === "Escape";
    const inBar = (event.target as Element).closest(".bpg-controls");
    if (event.key === "Escape" && onEscape && !inBar) {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.target !== event.currentTarget) return;
    const step = 48;
    const action: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, step),
      ArrowDown: () => panBy(0, -step),
      "+": () => zoomBy(1.25),
      "=": () => zoomBy(1.25),
      "-": () => zoomBy(0.8),
      "0": () => fit(true),
    };
    if (!action[event.key]) return;
    event.preventDefault();
    action[event.key]();
  };
  return (
    <div
      ref={frame}
      className="bpg-canvas bpg-frame"
      tabIndex={0}
      role="region"
      aria-label={label}
      aria-describedby={describedBy}
      data-dragging={dragging || undefined}
      data-selected={selected ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={(event) => {
        // A touch is captured by the element under the finger until the drag
        // takes it over; that element's loss of it does not end the drag.
        if (event.target === event.currentTarget) onPointerUp(event);
      }}
      onClickCapture={(event) => {
        // A drag that ends on an element is not a choice of it.
        if (moved.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={(event) => {
        const target = event.target as Element;
        if (target.closest("[role=button], .bpg-controls, .bpg-minimap")) return;
        onClear?.();
      }}
      onKeyDown={onKeyDown}
    >
      <svg role="group" aria-label={svgLabel}>
        {camera && (
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
            {children}
          </g>
        )}
        {camera && pinned && (
          <g
            transform={`translate(${camera.x} ${Math.max(camera.y, -pinned.top * camera.k)}) scale(${camera.k})`}
          >
            {pinned.content}
          </g>
        )}
      </svg>
      {camera && hasMap && mapShown && view.width > 0 && (
        <Minimap
          drawing={viewBox}
          outline={outline}
          camera={camera}
          view={view}
          onCentre={centreOn}
        />
      )}
      <GraphControls
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(0.8)}
        onFit={() => fit(true)}
        legend={legend}
        notes={notes}
        title={title}
        levels={levels}
        map={
          hasMap
            ? { shown: mapShown, onToggle: () => setMapShown((shown) => !shown) }
            : undefined
        }
      />
    </div>
  );
}

const MAP = { width: 144, height: 96 };

/**
 * The whole drawing small, in the frame's corner above the bar, with the part
 * in view outlined; pressing or dragging on it centres the view there.
 */
function Minimap({
  drawing,
  outline,
  camera,
  view,
  onCentre,
}: {
  drawing: Rect;
  outline: Rect[];
  camera: Camera;
  view: { width: number; height: number };
  onCentre: (x: number, y: number) => void;
}) {
  const map = minimapView(drawing, camera, view, MAP);
  // With the whole drawing in view there is nowhere to go, and the map would
  // only cover a corner of it.
  if (map.shown.width >= map.width - 1 && map.shown.height >= map.height - 1) return null;
  const centre = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onCentre(
      drawing.x + (event.clientX - box.left) / map.scale,
      drawing.y + (event.clientY - box.top) / map.scale,
    );
  };
  return (
    <svg
      className="bpg-minimap"
      role="img"
      aria-label="Minimap of the whole diagram"
      width={map.width}
      height={map.height}
      onPointerDown={(event) => {
        // The frame would take this as the start of a drag of the drawing.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        centre(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) centre(event);
      }}
    >
      {outline.map((box, index) => (
        <rect
          key={index}
          x={(box.x - drawing.x) * map.scale}
          y={(box.y - drawing.y) * map.scale}
          width={box.width * map.scale}
          height={box.height * map.scale}
        />
      ))}
      <rect className="bpg-minimap-view" {...map.shown} />
    </svg>
  );
}

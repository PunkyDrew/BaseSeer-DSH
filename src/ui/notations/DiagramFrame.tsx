import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GraphControls } from "../graph-controls.tsx";
import type { Rect } from "./types.ts";

type Camera = { x: number; y: number; k: number };
const MIN_ZOOM = 0.1,
  MAX_ZOOM = 2.5,
  PADDING = 24;
/** Below this the labels cannot be read; a drawing that would fit smaller opens on its start, and Fit still shows it whole. */
const READABLE = 0.7,
  START_ZOOM = 0.9;

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
  /** Where a drawing too large to read whole opens; its top left corner otherwise. */
  start?: Rect;
  /** What the drawing opens on when it fits readably: the drawing without what stands beside it (notes), which Fit includes. */
  opening?: Rect;
  /** Pixels at the frame's bottom that a sheet covers; the selection is kept above them. */
  inset?: number;
  /** The drawing's name, in the bar under it. */
  title: string;
  children: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const placed = useRef(false);
  placed.current = camera !== null;
  const [dragging, setDragging] = useState(false);
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
    setCamera(
      always || whole >= READABLE
        ? {
            k: whole,
            x: (el.clientWidth - target.width * whole) / 2 - target.x * whole,
            y: (height - target.height * whole) / 2 - target.y * whole,
          }
        : start
          ? {
              // Centred on the start, from the drawing's top edge so its frame heading shows.
              k: START_ZOOM,
              x: el.clientWidth / 2 - (start.x + start.width / 2) * START_ZOOM,
              y: PADDING - viewBox.y * START_ZOOM,
            }
          : {
              k: START_ZOOM,
              x: PADDING - viewBox.x * START_ZOOM,
              y: PADDING - viewBox.y * START_ZOOM,
            },
    );
  };
  // The drawing's bounds, by value: a drawing redrawn as it was keeps its camera.
  const bounds = [viewBox.x, viewBox.y, viewBox.width, viewBox.height];
  useLayoutEffect(() => fit(), bounds);
  useLayoutEffect(() => {
    // A selection made elsewhere, or one a sheet now covers, is brought into
    // the part of the frame that stays visible, at the zoom it is at.
    const el = frame.current,
      target = selected ?? reveal;
    if (!target || !el || !camera) return;
    const width = el.clientWidth,
      height = el.clientHeight - Math.max(inset, strip(el));
    const left = target.x * camera.k + camera.x,
      top = target.y * camera.k + camera.y,
      right = left + target.width * camera.k,
      bottom = top + target.height * camera.k;
    if (left >= 0 && top >= 0 && right <= width && bottom <= height) return;
    setCamera({
      k: camera.k,
      x: width / 2 - (target.x + target.width / 2) * camera.k,
      y:
        target.height * camera.k > height - 2 * PADDING
          ? height - PADDING - (target.y + target.height) * camera.k
          : height / 2 - (target.y + target.height / 2) * camera.k,
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
      <GraphControls
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(0.8)}
        onFit={() => fit(true)}
        legend={legend}
        notes={notes}
        title={title}
      />
    </div>
  );
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type GraphSize = { width: number; height: number };
export type GraphSizes = Record<string, GraphSize>;
export type ReportGraphSize = (id: string, size: GraphSize) => void;

export function useGraphMeasurements() {
  const [sizes, setSizes] = useState<GraphSizes>({});
  const report = useCallback<ReportGraphSize>((id, size) => {
    setSizes((previous) =>
      previous[id]?.width === size.width && previous[id]?.height === size.height
        ? previous
        : { ...previous, [id]: size },
    );
  }, []);
  return { sizes, report };
}

// Measure the complete, wrapping content before positioning it. offset sizes
// are in graph coordinates, unaffected by React Flow's viewport zoom.
export function useMeasuredGraphItem<T extends HTMLElement>(
  id: string,
  report: ReportGraphSize,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      report(id, {
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, report]);
  return ref;
}

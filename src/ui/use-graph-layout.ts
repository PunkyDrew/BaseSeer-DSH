import { useEffect, useMemo, useState } from "react";
import {
  layeredLayout,
  type LayoutInput,
  type LayoutEdge,
} from "./layered-layout.ts";
import type { Box } from "./graph-routing.ts";

// Geometry changes asynchronously. Keep the last same-topology layout during
// measurement, discard superseded results and never show another graph's data.
export function useGraphLayout<N extends Box, E extends LayoutEdge>(
  input: LayoutInput<N, E>,
) {
  const topology = JSON.stringify([
    input.nodes.map((n) => n.id),
    input.edges.map((e) => [e.id, e.from, e.to]),
  ]);
  const key = JSON.stringify([
    topology,
    input.direction,
    input.nodes.map((n) => [n.width, n.height]),
    input.edges.map((e) => (e.label ? [e.label.width, e.label.height] : null)),
  ]);
  const [attempt, retry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    topology: string;
    layout: LayoutInput;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setError("");
    void layeredLayout(input)
      .then((layout) => {
        if (current) setState({ key, topology, layout });
      })
      .catch(() => {
        if (current)
          setError(
            "The diagram could not be arranged. Try arranging it again.",
          );
      });
    return () => {
      current = false;
    };
  }, [key, attempt]);
  const ready = state?.topology === topology;
  const layout = useMemo(() => {
    if (!ready) return { nodes: [] as N[], edges: [] as (E & LayoutEdge)[] };
    const nodes = new Map(state!.layout.nodes.map((n) => [n.id, n])),
      edges = new Map(state!.layout.edges.map((e) => [e.id, e]));
    return {
      nodes: input.nodes.map((n) => ({
        ...n,
        x: nodes.get(n.id)!.x,
        y: nodes.get(n.id)!.y,
      })),
      edges: input.edges.map((e) => ({
        ...e,
        points: edges.get(e.id)!.points,
        label: edges.get(e.id)!.label,
      })),
    };
  }, [input, state, ready]);
  return {
    layout,
    ready,
    pending: state?.key !== key,
    error,
    retry: () => retry((n) => n + 1),
  };
}

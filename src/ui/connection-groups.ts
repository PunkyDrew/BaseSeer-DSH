import type { SourceConnection } from "../contracts/source-connections.ts";

export type ConnectionGroup = {
  id: string;
  from: string;
  to: string;
  basis: SourceConnection["basis"];
  stale: boolean;
  label: string;
  items: SourceConnection[];
};

// A display projection only: retain every source site and its evidence. Never
// combine opposite directions, historical/current evidence or distinct claims.
export function groupConnections(items: SourceConnection[]): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>();
  for (const item of items) {
    const id = JSON.stringify([
      item.from,
      item.to,
      item.basis,
      item.stale,
      item.basis === "inferred" ? item.id : "references",
    ]);
    const group = groups.get(id) ?? {
      id,
      from: item.from,
      to: item.to,
      basis: item.basis,
      stale: item.stale,
      label: item.label,
      items: [],
    };
    group.items.push(item);
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    if (group.items.length < 2) continue;
    const imports = group.items.filter(
      (c) => !c.kind.startsWith("static-"),
    ).length;
    const references = group.items.length - imports;
    group.label = [
      imports ? `${imports} ${imports === 1 ? "import" : "imports"}` : "",
      references
        ? `${references} ${references === 1 ? "reference" : "references"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [...groups.values()];
}

export function connectionBasis(item: SourceConnection) {
  return item.basis === "inferred"
    ? "Inferred"
    : item.kind.startsWith("static-")
      ? "Observed static reference"
      : "Observed import";
}

export function connectionDetailGroups(neighborhood: {
  connections: SourceConnection[];
  incoming: SourceConnection[];
  outgoing: SourceConnection[];
}) {
  // The canvas is bounded, but inspecting a file must still expose every
  // incoming/outgoing reference, including peers omitted from that canvas.
  return groupConnections([
    ...new Map(
      [
        ...neighborhood.connections,
        ...neighborhood.incoming,
        ...neighborhood.outgoing,
      ].map((c) => [c.id, c]),
    ).values(),
  ]);
}

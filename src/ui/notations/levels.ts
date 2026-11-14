import type { Document, PlanningRecord } from "../../domain/records.ts";

// A plan's parts open level by level: the top level shows the parts in no
// container, and opening a container shows the parts directly inside it.
// Containment comes only from component.data.parent; an interface sits beside
// the part that provides it, since it is that part's face to the others.

/** The container whose own diagram is open; "" is the plan's top level. */
export type DiagramLevel = string;
/** The breadcrumb to a level: its containers from the top down, the open one last. */
export type LevelPath = { id: string; title: string }[];
/** A part a search found, with the containers it sits in. */
export type PartMatch = {
  id: string;
  title: string;
  kind: string;
  level: DiagramLevel;
  path: LevelPath;
};

/** Ancestor chains from component.data.parent, with cycle/missing warnings. */
export function containmentIndex(records: readonly PlanningRecord[]) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const warnings: string[] = [];
  const ancestors = new Map<string, string[]>();
  for (const r of records.filter((r) => r.kind === "component")) {
    const seen = new Set([r.id]),
      chain: string[] = [];
    let parent: string | undefined = r.data.parent;
    while (parent) {
      if (seen.has(parent)) {
        warnings.push(
          `Containment loop at ${r.title}; grouping is incomplete.`,
        );
        break;
      }
      seen.add(parent);
      const value = byId.get(parent);
      if (!value || value.kind !== "component") {
        warnings.push(`${r.title} names a missing container ${parent}.`);
        break;
      }
      chain.push(parent);
      parent = value.data.parent;
    }
    ancestors.set(r.id, chain);
  }
  return { byId, ancestors, warnings: [...new Set(warnings)] };
}

export type PartLevels = ReturnType<typeof partLevels>;

/** Where each component and interface of the plan sits, level by level. */
export function partLevels(doc: Document) {
  const { byId, ancestors, warnings } = containmentIndex(doc.records);
  const provider = new Map<string, string>();
  for (const link of doc.links)
    if (
      link.kind === "implements" &&
      byId.get(link.from)?.kind === "component" &&
      !provider.has(link.to)
    )
      provider.set(link.to, link.from);
  const parts = doc.records.filter(
    (r) => r.kind === "component" || r.kind === "interface",
  );
  // Each part's containers, nearest first.
  const chains = new Map(
    parts.map((r) => [
      r.id,
      r.kind === "interface"
        ? (ancestors.get(provider.get(r.id) ?? "") ?? [])
        : (ancestors.get(r.id) ?? []),
    ]),
  );
  const chain = (id: string) => chains.get(id) ?? [];
  const levelOf = (id: string): DiagramLevel => chain(id)[0] ?? "";
  const held = new Map<DiagramLevel, PlanningRecord[]>();
  for (const r of parts) {
    const level = levelOf(r.id);
    held.set(level, [...(held.get(level) ?? []), r]);
  }
  /** The parts drawn directly on a level. */
  const children = (level: DiagramLevel) => held.get(level) ?? [];
  /** True when the part sits somewhere inside the level; every part is inside the top level. */
  const within = (id: string, level: DiagramLevel) =>
    chains.has(id) && (!level || chain(id).includes(level));
  /** How many parts a container holds at every depth; 0 for a part that is not a container. */
  const inside = (id: string) =>
    held.has(id) ? parts.filter((r) => chain(r.id).includes(id)).length : 0;
  /**
   * The box a part appears as on a level's diagram: the part itself, the
   * closed container holding it, or, for a part outside the level, the box
   * it has in the diagram that holds both; null when it is the level itself
   * or one of the level's own containers.
   */
  const boxOn = (id: string, level: DiagramLevel): string | null => {
    if (!chains.has(id) || id === level || chain(level).includes(id)) return null;
    const shared = within(id, level)
      ? level
      : (chain(level).find((a) => chain(id).includes(a)) ?? "");
    const line = [id, ...chain(id)];
    const at = shared ? line.indexOf(shared) : line.length;
    return line[at - 1];
  };
  const path = (level: DiagramLevel): LevelPath =>
    level && byId.has(level)
      ? [...chain(level)]
          .reverse()
          .concat(level)
          .map((id) => ({ id, title: byId.get(id)!.title }))
      : [];
  /** The level while it still holds parts, else the nearest container above it that does. */
  const usable = (level: DiagramLevel): DiagramLevel =>
    [level, ...chain(level)].find((id) => id && held.has(id)) ?? "";
  /** Parts whose name or id contains the query, those whose name starts with it first. */
  const search = (query: string): PartMatch[] => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return [];
    const starts = (r: PlanningRecord) =>
      r.title.toLowerCase().startsWith(wanted) ? 0 : 1;
    return parts
      .filter(
        (r) =>
          r.title.toLowerCase().includes(wanted) ||
          r.id.toLowerCase().includes(wanted),
      )
      .sort((a, b) => starts(a) - starts(b))
      .map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        level: levelOf(r.id),
        path: path(levelOf(r.id)),
      }));
  };
  return { byId, warnings, levelOf, children, within, inside, boxOn, path, usable, search };
}

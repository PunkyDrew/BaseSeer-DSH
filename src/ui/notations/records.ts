import {
  shapeName,
  type Document,
  type PlanningRecord,
} from "../../domain/records.ts";
import type { GraphSizes } from "../use-graph-measurements.ts";
import { clip } from "./geometry.ts";
import { partLevels, type DiagramLevel } from "./levels.ts";
import { partNode } from "./structural.ts";
import type {
  StructuralEdge,
  StructuralNode,
  StructuralProjection,
} from "./types.ts";

// The plan's records as a UML class diagram. A shape an interface declares is
// a «dataType» nested in that interface, its fields the attributes; a name a
// contract uses that no interface shapes is a «dataType» with an empty
// compartment, so the gap shows. A component's contract puts it in the
// picture: a record one part gives out (an output or a write) and another
// takes in passes between them as an information flow, along a dependency the
// plan records between the two, directly or through an interface one of them
// provides; a composition joins a part to each record it owns; and a record a
// part takes in or gives out with no part at the other end is a «use» or
// «create» dependency from the part to the record.

const LINE = 16;
const lists = ["owns", "inputs", "outputs", "writes"] as const;

function dataType(
  id: string,
  carrier: PlanningRecord | null,
  shape: { name: string; fields: string[]; version?: string },
  status: string,
  sizes: GraphSizes,
): StructuralNode {
  const attributes = shape.fields.map((f) => clip(f, 44));
  const longest = Math.max(shape.name.length + 4, ...attributes.map((a) => a.length));
  return {
    id,
    record: carrier?.id ?? "",
    title: shape.name,
    kind: "Record",
    summary: carrier ? `Crosses ${carrier.title}.` : "No agreed shape is recorded for it.",
    symbol: "class",
    typeLine: "«dataType»",
    files: [],
    attributes,
    external: false,
    status,
    parent: carrier?.id ?? null,
    boundary: false,
    x: 0,
    y: 0,
    width: sizes[id]?.width ?? Math.min(340, Math.max(170, longest * 7 + 28)),
    height: sizes[id]?.height ?? 60 + LINE * attributes.length,
    details: [
      ...(shape.fields.length ? [{ label: "Fields", text: shape.fields.join("; ") }] : []),
      ...(shape.version ? [{ label: "Version", text: shape.version }] : []),
    ],
  };
}

/**
 * UML class diagram of the plan's records: each interface's shapes nested in
 * it, the records that pass between parts, and each part's ownership and loose
 * ends, level by level: the parts on the level shown, each container among
 * them closed with what it passes to the boxes around it.
 */
export function projectRecords(
  doc: Document,
  status: (r: PlanningRecord) => string,
  sizes: GraphSizes = {},
  level: DiagramLevel = "",
): StructuralProjection {
  const nodes: StructuralNode[] = [];
  const edges: StructuralEdge[] = [];
  const byId = new Map(doc.records.map((r) => [r.id, r]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const names = (c: PlanningRecord, list: (typeof lists)[number]): string[] =>
    c.data.contract?.[list] ?? [];
  const given = (c: PlanningRecord) => [...names(c, "outputs"), ...names(c, "writes")];
  const levels = partLevels(doc);
  const namers = doc.records.filter(
    (r) => r.kind === "component" && lists.some((list) => names(r, list).length),
  );
  // A part's box on this level: the part itself when it sits directly on the
  // level, the closed container holding it, or a box outside the level.
  const boxOf = (id: string) => levels.boxOn(id, level);
  // The parts that show their own records here; what lies deeper stays
  // inside its closed container.
  const own = namers.filter((c) => levels.levelOf(c.id) === level);
  const boxes = new Set(
    namers.flatMap((c) => {
      const box = levels.within(c.id, level) ? boxOf(c.id) : null;
      return box ? [box] : [];
    }),
  );
  // The pairs of parts a record can pass between: one uses the other, or an
  // interface the other provides.
  const provider = new Map<string, string>();
  for (const l of doc.links)
    if (l.kind === "implements" && !provider.has(l.to)) provider.set(l.to, l.from);
  const linked = new Set<string>();
  for (const l of doc.links)
    if (l.kind === "uses") {
      const to = provider.get(l.to) ?? l.to;
      linked.add(`${l.from}>${to}`).add(`${to}>${l.from}`);
    }
  // Flows are found between the parts themselves, then drawn between their
  // boxes on this level, so a closed container carries what its parts pass.
  const flows = new Map<string, { from: string; to: string; names: string[] }>();
  // A record's loose ends are the parts that give it out or take it in with
  // no part at the other end anywhere in the plan.
  const carried = new Set<string>();
  const addFlow = (from: PlanningRecord, to: PlanningRecord, name: string) => {
    if (!levels.within(from.id, level) && !levels.within(to.id, level)) return;
    const fromBox = boxOf(from.id);
    const toBox = boxOf(to.id);
    if (!fromBox || !toBox || fromBox === toBox) return;
    const flow = flows.get(`${fromBox}>${toBox}`) ?? { from: fromBox, to: toBox, names: [] };
    if (!flow.names.some((n) => shapeName(n) === shapeName(name))) flow.names.push(name);
    flows.set(`${fromBox}>${toBox}`, flow);
    boxes.add(fromBox).add(toBox);
  };
  for (const from of namers)
    for (const to of namers) {
      if (from === to || !linked.has(`${from.id}>${to.id}`)) continue;
      for (const name of given(from)) {
        const key = shapeName(name);
        if (!names(to, "inputs").some((n) => shapeName(n) === key)) continue;
        carried.add(`${from.id}>${key}`).add(`${key}>${to.id}`);
        addFlow(from, to, name);
      }
    }
  const named = new Set([
    ...own.flatMap((c) => lists.flatMap((list) => names(c, list).map(shapeName))),
    ...[...flows.values()].flatMap((f) => f.names.map(shapeName)),
  ]);
  // An interface is drawn where its shapes are named, or on its own level
  // when nothing names them, so the gap still shows somewhere.
  const drawn = (iface: PlanningRecord) =>
    levels.levelOf(iface.id) === level ||
    iface.data.shapes.some((s: { name: string }) => named.has(shapeName(s.name)));
  // A name resolves to the first interface that shapes it.
  const shaped = new Map<string, string>();
  const interfaces = doc.records.filter(
    (r) => r.kind === "interface" && r.data.shapes?.length && drawn(r),
  );
  for (const iface of interfaces) {
    nodes.push(partNode(iface, status(iface), sizes, null, true));
    for (const shape of iface.data.shapes) {
      const id = `${iface.id}/${shapeName(shape.name)}`;
      if (!shaped.has(shapeName(shape.name))) shaped.set(shapeName(shape.name), id);
      nodes.push(dataType(id, iface, shape, status(iface), sizes));
    }
  }
  const unshaped = new Map<string, string>();
  const record = (name: string) => {
    const key = shapeName(name);
    if (shaped.has(key)) return shaped.get(key)!;
    if (!unshaped.has(key)) {
      unshaped.set(key, `record/${key}`);
      nodes.push(dataType(`record/${key}`, null, { name, fields: [] }, "", sizes));
    }
    return unshaped.get(key)!;
  };
  for (const id of boxes) {
    const part = byId.get(id)!;
    const folded = levels.inside(id);
    nodes.push({
      ...partNode(part, status(part), sizes, null, false),
      ...(folded ? { folded } : {}),
    });
  }
  for (const { from, to, names } of flows.values())
    edges.push({
      id: `${from}>${to}:flow`,
      from,
      to,
      type: "flow",
      title: "flow",
      kind: "Relationship",
      summary: `${names.join(", ")} passes from ${title(from)} to ${title(to)}.`,
      label: ["«flow»", clip(names.join(", "), 30)],
    });
  const depend = (c: PlanningRecord, name: string, type: "owns" | "use" | "create", summary: string) => {
    const to = record(name);
    if (edges.some((e) => e.id === `${c.id}>${to}:${type}`)) return;
    edges.push({
      id: `${c.id}>${to}:${type}`,
      from: c.id,
      to,
      type,
      title: type,
      kind: "Relationship",
      summary,
      label: type === "owns" ? [] : [`«${type}»`],
    });
  };
  for (const c of own) {
    for (const name of names(c, "owns")) depend(c, name, "owns", `${c.title} owns ${name}.`);
    for (const name of names(c, "inputs"))
      if (!carried.has(`${shapeName(name)}>${c.id}`))
        depend(c, name, "use", `${c.title} takes ${name} in; no part is recorded giving it to ${c.title}.`);
    for (const name of given(c))
      if (!carried.has(`${c.id}>${shapeName(name)}`))
        depend(c, name, "create", `${c.title} gives ${name} out; no part is recorded taking it from ${c.title}.`);
  }
  return {
    nodes,
    edges,
    note: "UML class diagram of the plan's records. A «dataType» is a record, its fields listed under its name, drawn inside the «interface» that carries it; one with an empty compartment is named by a contract but has no agreed shape. A dashed arrow marked «flow» between two parts is an information flow: the record named on it passes from one to the other, along a dependency the plan records between them. A solid line with a filled diamond at a part is a composition: the part owns the record. A dashed arrow from a part to a record marked «use» or «create» is a dependency: the part takes the record in, or gives it out, and no part is recorded at the other end.",
    empty: "No records are shaped yet. Give an interface the fields of the records that cross it, and the components their inputs and outputs, in chat.",
    warnings: [],
  };
}

import type { Link } from "../../domain/records.ts";
import type { GraphItem } from "../graph-model.ts";

export type Notation =
  | "uml-component"
  | "uml-class"
  | "uml-deployment"
  | "flow"
  | "uml-sequence"
  | "matrix";
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

export type FlowMessage = {
  id: string;
  send: string;
  receive: string;
  kind: "synchronous" | "asynchronous" | "reply";
  label: string;
  guard?: string;
};

/** A box's UML form: a part, an interface, an actor, a class, a node (a 3D box), or a comment anchored to what it concerns. */
export type Symbol = "person" | "component" | "interface" | "class" | "node" | "comment";
export interface StructuralNode extends GraphItem {
  record: string;
  x: number;
  y: number;
  width: number;
  height: number;
  symbol: Symbol;
  /** The element's stereotype as UML writes it: «component», «interface», «actor», «requirement»; a plain node has none. */
  typeLine: string;
  /** UML lists a component's planned files as its «artifacts». */
  files: string[];
  /** A class's attribute compartment: a record's fields. */
  attributes: string[];
  external: boolean;
  status: string;
  /** Displayed containing node, or null at the top level. */
  parent: string | null;
  /** True when other displayed nodes sit inside this one. */
  boundary: boolean;
}
export interface StructuralEdge extends GraphItem {
  from: string;
  to: string;
  /** A link kind; "anchor" for the dashed line from a comment to its subject; "owns" for a composition; "flow" for an information flow; "path" for a communication path. */
  type: string;
  /** The arrow's label lines; UML dependencies carry none, their line says what they are. */
  label: string[];
  /** The one link an arrow shows; a merged arrow lists its links in details. */
  link?: Link;
  points?: Point[];
}
export interface StructuralProjection {
  nodes: StructuralNode[];
  edges: StructuralEdge[];
  note: string;
  empty: string;
  warnings: string[];
}

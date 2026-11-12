import type { Document, PlanningRecord } from "../../domain/records.ts";
import type { GraphItem } from "../graph-model.ts";
import { containmentIndex } from "./structural.ts";
import type { FlowMessage } from "./types.ts";

// One reading of a scenario that the activity and sequence diagrams share, so
// both draw the same steps in the same order. A step list becomes a flow of
// steps in their recorded order; a recorded flow keeps its own transitions.
export interface ScenarioStep {
  /** The local ID transitions and messages refer to. */
  id: string;
  /** Selection and support key, unique in the plan. */
  key: string;
  /** Component or interface doing the step, or "" when none is recorded. */
  part: string;
  action: string;
  state: string;
  data: string;
  outcome: string;
  terminal: boolean;
  /** Statements of the scenario this step shows, for the support panel. */
  targets: string[];
}
export interface ScenarioTransition {
  key: string;
  from: string;
  to: string;
  condition: string;
  data: string;
  kind: string;
  /** Returns to a step already on the path: a retry or loop. */
  back: boolean;
  targets: string[];
}
/** The order a sequence diagram reads in, with UML's combined fragments. */
export type Block =
  | { kind: "step"; step: string }
  | { kind: "message"; transition: string }
  | { kind: "alt"; operands: { guard: string; blocks: Block[] }[] }
  | { kind: "break"; guard: string; blocks: Block[] }
  | { kind: "loop"; guard: string; blocks: Block[] };
export interface ScenarioModel {
  scenario: PlanningRecord;
  form: "steps" | "flow";
  inferred: boolean;
  trigger: string;
  preconditions: string[];
  /** A step list's failures, which name no step; a flow draws its own. */
  errors: string[];
  recovery: string;
  entry: string;
  /** In the order the flow runs: each step after the steps that lead to it. */
  steps: ScenarioStep[];
  transitions: ScenarioTransition[];
  messages: FlowMessage[];
  /** Parts in the order they first act; "" stands for steps naming none. */
  parts: string[];
  /** Null when the branches do not nest, so no fragment would be true. */
  blocks: Block[] | null;
  warnings: string[];
}

/** Fragments are worked out up to this many steps; a larger flow is drawn without them. */
const STRUCTURE_LIMIT = 400;

export function scenarioModel(scenario: PlanningRecord): ScenarioModel {
  const d = scenario.data,
    s = scenario.id;
  const warnings: string[] = [];
  let steps: ScenarioStep[], transitions: ScenarioTransition[], entry: string;
  if (d.flow) {
    steps = d.flow.nodes.map((n: any) => ({
      id: n.id,
      key: `${s}:${n.id}`,
      part: n.component ?? "",
      action: n.action,
      state: n.state,
      data: n.data,
      outcome: "",
      terminal: n.terminal,
      targets: ["action", "state", "data"].map((k) => `nodes.${n.id}.${k}`),
    }));
    transitions = d.flow.transitions.map((t: any, i: number) => ({
      key: `${s}:transition:${i}`,
      from: t.from,
      to: t.to,
      condition: t.condition,
      data: t.data,
      kind: t.kind,
      back: false,
      targets: ["condition", "data"].map((k) => `transitions.${i}.${k}`),
    }));
    entry = d.flow.entry;
  } else {
    steps = d.steps.map((step: any, i: number) => ({
      id: `step-${i}`,
      key: `${s}:step:${i}`,
      part: step.component ?? "",
      action: step.action,
      state: "",
      data: "",
      outcome: step.outcome,
      terminal: i === d.steps.length - 1,
      targets: [`steps.${i}.action`, `steps.${i}.outcome`],
    }));
    transitions = steps.slice(1).map((step, i) => ({
      key: `${s}:order:${i + 1}`,
      from: steps[i].id,
      to: step.id,
      condition: "",
      data: "",
      kind: "next",
      back: false,
      targets: [],
    }));
    entry = steps[0]?.id ?? "";
  }
  const ids = new Set(steps.map((x) => x.id));
  for (const t of transitions)
    if (!ids.has(t.from) || !ids.has(t.to))
      warnings.push(
        `A transition names a missing step (${!ids.has(t.from) ? t.from : t.to}); it is not drawn.`,
      );
  transitions = transitions.filter((t) => ids.has(t.from) && ids.has(t.to));
  const outs = new Map(steps.map((x) => [x.id, [] as ScenarioTransition[]]));
  for (const t of transitions) outs.get(t.from)!.push(t);

  // Depth-first from the entry: a transition to a step still on the path is a
  // loop. Reverse post-order puts every step after those that lead to it, and
  // a branch visited later comes out earlier: failures are visited last, so
  // they sit right under the step they leave, and the rest keep their order.
  const visiting = new Map(
    [...outs].map(([id, out]) => [
      id,
      [
        ...out.filter((t) => t.kind !== "failure").reverse(),
        ...out.filter((t) => t.kind === "failure").reverse(),
      ],
    ]),
  );
  const seen = new Map<string, "open" | "done">(),
    order: string[] = [];
  const visit = (root: string) => {
    const post: string[] = [],
      stack = [{ id: root, next: 0 }];
    seen.set(root, "open");
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = visiting.get(top.id)!;
      if (top.next < out.length) {
        const t = out[top.next++];
        const state = seen.get(t.to);
        if (state === "open") t.back = true;
        else if (!state) {
          seen.set(t.to, "open");
          stack.push({ id: t.to, next: 0 });
        }
      } else {
        seen.set(top.id, "done");
        post.push(top.id);
        stack.pop();
      }
    }
    order.push(...post.reverse());
  };
  if (ids.has(entry)) visit(entry);
  else if (steps.length)
    warnings.push("The flow's entry names no step; it starts at its first step.");
  for (const x of steps)
    if (!seen.has(x.id)) {
      if (ids.has(entry))
        warnings.push(`“${x.action}” cannot be reached from the flow's start.`);
      visit(x.id);
    }
  const byId = new Map(steps.map((x) => [x.id, x]));
  steps = order.map((id) => byId.get(id)!);
  return {
    scenario,
    form: d.flow ? "flow" : "steps",
    inferred: Boolean(d.source),
    trigger: d.trigger ?? "",
    preconditions: d.preconditions ?? [],
    errors: d.flow ? [] : (d.errors ?? []),
    recovery: d.flow ? "" : (d.recovery ?? ""),
    entry: steps[0]?.id ?? "",
    steps,
    transitions,
    messages: (d.flow?.messages ?? []).filter(
      (m: FlowMessage) => ids.has(m.send) && ids.has(m.receive),
    ),
    parts: [...new Set(steps.map((x) => x.part))],
    blocks: steps.length <= STRUCTURE_LIMIT ? structure(steps, outs) : null,
    warnings: [...new Set(warnings)],
  };
}

// Combined fragments from the flow's shape: a step with several ways forward
// is an alt, with a break for each way that ends on its own; a loop wraps the
// steps a transition returns over. A flow whose branches cross each other has
// no truthful nesting, so it gets none.
function structure(
  steps: ScenarioStep[],
  outs: Map<string, ScenarioTransition[]>,
): Block[] | null {
  const rank = new Map(steps.map((x, i) => [x.id, i]));
  const forward = (id: string) => outs.get(id)!.filter((t) => !t.back);
  const reach = new Map<string, Set<string>>();
  for (const x of [...steps].reverse())
    reach.set(
      x.id,
      new Set([x.id, ...forward(x.id).flatMap((t) => [...reach.get(t.to)!])]),
    );
  const placed = new Set<string>();
  let nested = true;
  const region = (start: string | undefined, stop?: string): Block[] => {
    const blocks: Block[] = [];
    let at = start;
    while (at !== undefined && at !== stop) {
      if (placed.has(at)) {
        nested = false;
        break;
      }
      placed.add(at);
      blocks.push({ kind: "step", step: at });
      const ways = forward(at);
      if (!ways.length) break;
      if (ways.length === 1) {
        blocks.push({ kind: "message", transition: ways[0].key });
        at = ways[0].to;
        continue;
      }
      // A way ends on its own when it reaches no step another way reaches.
      const ends = (t: ScenarioTransition) =>
        !(stop && reach.get(t.to)!.has(stop)) &&
        ways.every(
          (o) =>
            o === t ||
            ![...reach.get(t.to)!].some((x) => reach.get(o.to)!.has(x)),
        );
      let onward = ways.filter((t) => !ends(t));
      // When every way ends on its own, the one way that is not a failure is
      // the main line and the failures break off it.
      if (!onward.length) {
        const main = ways.filter((t) => t.kind !== "failure");
        if (main.length === 1) onward = main;
      }
      const branch = (t: ScenarioTransition, until?: string): Block[] => [
        { kind: "message", transition: t.key },
        ...region(t.to, until),
      ];
      if (onward.length && onward.length < ways.length)
        for (const t of ways.filter((t) => !onward.includes(t)))
          blocks.push({ kind: "break", guard: t.condition, blocks: branch(t) });
      const alternatives = onward.length ? onward : ways;
      if (alternatives.length === 1) {
        blocks.push({ kind: "message", transition: alternatives[0].key });
        at = alternatives[0].to;
        continue;
      }
      const merge = [...reach.get(alternatives[0].to)!]
        .filter((x) => alternatives.every((t) => reach.get(t.to)!.has(x)))
        .sort((a, b) => rank.get(a)! - rank.get(b)!)[0];
      blocks.push({
        kind: "alt",
        operands: alternatives.map((t) => ({
          guard: t.condition,
          blocks: branch(t, merge ?? stop),
        })),
      });
      at = merge ?? stop;
    }
    return blocks;
  };
  const blocks = region(steps[0]?.id);
  if (!nested || placed.size !== steps.length) return null;
  const has = (block: Block, id: string): boolean =>
    block.kind === "step"
      ? block.step === id
      : block.kind === "alt"
        ? block.operands.some((o) => o.blocks.some((b) => has(b, id)))
        : block.kind === "message"
          ? false
          : block.blocks.some((b) => has(b, id));
  const target = new Map(steps.flatMap((x) => outs.get(x.id)!.map((t) => [t.key, t.to])));
  const wrap = (list: Block[], t: ScenarioTransition): boolean => {
    let start = list.findIndex((b) => b.kind === "step" && b.step === t.to);
    // The loop repeats the message that asks for its first step, too.
    const before = list[start - 1];
    if (before?.kind === "message" && target.get(before.transition) === t.to) start--;
    const end = list.findIndex((b, i) => i >= start && has(b, t.from));
    if (start >= 0 && end >= 0) {
      list.splice(start, end - start + 1, {
        kind: "loop",
        guard: t.condition,
        blocks: list.slice(start, end + 1),
      });
      return true;
    }
    return list.some((b) =>
      b.kind === "alt"
        ? b.operands.some((o) => wrap(o.blocks, t))
        : b.kind === "loop" || b.kind === "break"
          ? wrap(b.blocks, t)
          : false,
    );
  };
  for (const t of [...outs.values()].flat().filter((t) => t.back))
    if (!wrap(blocks, t)) return null;
  return blocks;
}

/** Scenarios with a step done by the part or by a part inside it, in plan order. */
export function scenariosThrough(doc: Document, part: string): PlanningRecord[] {
  const { ancestors } = containmentIndex(doc.records);
  const inside = (id: string) =>
    id === part || (ancestors.get(id) ?? []).includes(part);
  return doc.records.filter(
    (r) =>
      r.kind === "scenario" &&
      [...(r.data.steps ?? []), ...(r.data.flow?.nodes ?? [])].some(
        (step: any) => step.component && inside(step.component),
      ),
  );
}

/** Detail-panel item for a step or transition; support targets match the scenario's statements. */
export function scenarioItem(model: ScenarioModel, key: string): GraphItem | null {
  const scenario = model.scenario;
  const basis = model.inferred
    ? "Read from cited source code, not designed or run. Its order is not confirmed."
    : "Intended behavior recorded in this scenario. It is not a runtime trace.";
  const step = model.steps.find((x) => x.key === key);
  if (step)
    return {
      id: key,
      record: step.part || scenario.id,
      basis: scenario.id,
      title: step.action,
      kind: step.terminal ? "Outcome" : "Step",
      summary: step.outcome || [step.state, step.data].filter(Boolean).join(" · "),
      supportTargets: step.targets,
      details: [
        ...(step.outcome ? [{ label: "Outcome", text: step.outcome }] : []),
        ...(step.state ? [{ label: "State", text: step.state }] : []),
        ...(step.data ? [{ label: "Data", text: step.data }] : []),
        { label: "Scenario", text: scenario.title },
        { label: "Basis", text: basis },
      ],
    };
  const t = model.transitions.find((x) => x.key === key);
  if (!t) return null;
  const action = (id: string) => model.steps.find((x) => x.id === id)!.action;
  return {
    id: key,
    record: scenario.id,
    basis: scenario.id,
    title: t.condition || `${action(t.from)} → ${action(t.to)}`,
    kind: t.back ? "Repeats an earlier step" : "Transition",
    summary: [t.condition, t.data && `Data: ${t.data}`].filter(Boolean).join(". "),
    supportTargets: t.targets.length ? t.targets : undefined,
    details: [
      { label: "From", text: action(t.from) },
      { label: "To", text: action(t.to) },
      { label: "Condition", text: t.condition || "None: it always follows." },
      ...(t.data ? [{ label: "Data", text: t.data }] : []),
      { label: "Basis", text: basis },
    ],
  };
}

// The parts against the flows: how many steps each part takes in each. A part
// in no flow is a gap worth seeing, so every part with nothing inside it has a
// row; a container has one only when a step names it.
export function scenarioMatrix(doc: Document) {
  const scenarios = doc.records.filter((r) => r.kind === "scenario");
  const steps = scenarios.map((s) => scenarioModel(s).steps.map((step) => step.part));
  const named = new Set(steps.flat());
  const holding = new Set(doc.records.map((r) => r.data.parent).filter(Boolean));
  const parts = doc.records.filter(
    (r) => r.kind === "component" && (named.has(r.id) || !holding.has(r.id)),
  );
  return {
    scenarios,
    parts,
    count: (part: string, scenario: number) =>
      steps[scenario].filter((p) => p === part).length,
  };
}

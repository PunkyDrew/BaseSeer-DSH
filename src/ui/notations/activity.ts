import { clip, frameTag, wrapText } from "./geometry.ts";
import type { ScenarioModel, ScenarioTransition } from "./scenario.ts";
import type { Point, Rect } from "./types.ts";

// A scenario as a UML activity diagram: one partition (lane) per part, an
// initial node, the trigger as an accept-event action, an action per step
// with its outcome under it, a decision node where a step has several ways
// on, each way's guard lettered where it leaves the decision, a merge node
// where several ways arrive (UML would otherwise read them as a join), and a
// final node after each step the scenario ends on and goes no further from.
//
// Every node has a row of its own, so the gap under a row is free across all
// lanes for a horizontal run, and the gutter at each lane's sides is free for
// a vertical one: an arrow never crosses a node.
export type ActivityKind =
  | "initial"
  | "accept"
  | "action"
  | "decision"
  | "merge"
  | "final";
export interface ActivityNode extends Rect {
  id: string;
  kind: ActivityKind;
  lane: number;
  lines: string[];
  /** An action's outcome, lettered under its name. */
  sub: string[];
  /** The scenario step an action shows. */
  step?: string;
}
export interface ActivityEdge {
  id: string;
  transition?: ScenarioTransition;
  points: Point[];
  label?: { x: number; y: number; lines: string[] };
}
export interface ActivityLane {
  part: string;
  lines: string[];
  x: number;
  width: number;
}
export interface ActivityLayout {
  frame: Rect;
  tag: { text: string; path: string };
  lanes: ActivityLane[];
  laneTop: number;
  headerHeight: number;
  laneBottom: number;
  nodes: ActivityNode[];
  edges: ActivityEdge[];
  notes: (Rect & { title: string; lines: string[] })[];
  viewBox: Rect;
}

const LANE = 240,
  ACTION = 180,
  LINE = 15,
  DIAMOND = 28,
  GAP = 34,
  GUTTER = 10,
  NOTE = 250;

export function activityLayout(
  model: ScenarioModel,
  partTitle: (id: string) => string,
): ActivityLayout {
  const frameX = 16,
    frameY = 16;
  const tagText = `act ${clip(model.scenario.title, 72)}`;
  const tag = frameTag(frameX, frameY, tagText);
  const laneX = frameX + 16,
    laneTop = frameY + tag.height + 14;
  const lanes: ActivityLane[] = model.parts.map((part, i) => ({
    part,
    lines: wrapText(part ? partTitle(part) : "No part recorded", 28, 2),
    x: laneX + i * LANE,
    width: LANE,
  }));
  const laneOf = new Map(model.parts.map((p, i) => [p, i]));
  const headerHeight = 18 + LINE * Math.max(1, ...lanes.map((l) => l.lines.length));
  const center = (lane: number) => laneX + lane * LANE + LANE / 2;

  const incoming = new Map(model.steps.map((s) => [s.id, 0]));
  const outgoing = new Map(model.steps.map((s) => [s.id, 0]));
  for (const t of model.transitions) {
    incoming.set(t.to, incoming.get(t.to)! + 1);
    outgoing.set(t.from, outgoing.get(t.from)! + 1);
  }
  const entry = model.steps[0];
  if (entry) incoming.set(entry.id, incoming.get(entry.id)! + 1);
  const decides = (id: string) => outgoing.get(id)! > 1;
  // A guard is lettered where its way leaves the decision.
  const guard = (t: ScenarioTransition) =>
    decides(t.from) && t.condition ? wrapText(`[${t.condition}]`, 30, 2) : [];

  const nodes: ActivityNode[] = [];
  const at = new Map<string, ActivityNode>();
  const place = (
    id: string,
    kind: ActivityKind,
    lane: number,
    width: number,
    height: number,
    lines: string[] = [],
    step?: string,
    sub: string[] = [],
  ) => {
    const node = { id, kind, lane, lines, sub, step, x: center(lane) - width / 2, y: 0, width, height };
    nodes.push(node);
    at.set(id, node);
    return node;
  };
  const textBox = (lines: string[]) => 16 + LINE * lines.length;
  if (entry) {
    const lane = laneOf.get(entry.part)!;
    place("initial", "initial", lane, 18, 18);
    if (model.trigger) {
      const lines = wrapText(model.trigger, 26, 3);
      place("trigger", "accept", lane, ACTION, textBox(lines), lines);
    }
  }
  for (const step of model.steps) {
    const lane = laneOf.get(step.part)!;
    if (incoming.get(step.id)! > 1) place(`merge:${step.id}`, "merge", lane, DIAMOND, DIAMOND);
    const lines = wrapText(step.action, 24, 3),
      sub = step.outcome ? wrapText(step.outcome, 28, 2) : [];
    place(`action:${step.id}`, "action", lane, ACTION, Math.max(48, textBox([...lines, ...sub])), lines, step.key, sub);
    if (decides(step.id)) place(`decision:${step.id}`, "decision", lane, DIAMOND, DIAMOND);
    // A step the scenario ends on, with no way on from it, ends the activity.
    if (step.terminal && !outgoing.get(step.id)) place(`final:${step.id}`, "final", lane, 22, 22);
  }
  const into = (id: string) => at.get(`merge:${id}`) ?? at.get(`action:${id}`)!;
  const outOf = (id: string) => at.get(`decision:${id}`) ?? at.get(`action:${id}`)!;
  // The row under a decision is the taller for the guards lettered there,
  // one under another, each way's beside its own run.
  const guardLines = new Map<ActivityNode, number>();
  for (const t of model.transitions)
    if (!t.back) {
      const source = outOf(t.from);
      guardLines.set(source, (guardLines.get(source) ?? 0) + guard(t).length);
    }
  const gapBelow = (node: ActivityNode) =>
    guardLines.get(node) ? 8 + LINE * guardLines.get(node)! : 0;
  let y = laneTop + headerHeight + 8;
  for (const node of nodes) {
    y += GAP;
    node.y = y;
    y += node.height + gapBelow(node);
  }
  const laneBottom = y + 28;
  const row = new Map(nodes.map((n, i) => [n, i]));

  const edges: ActivityEdge[] = [];
  const bottom = (n: ActivityNode): Point => ({ x: n.x + n.width / 2, y: n.y + n.height });
  const top = (n: ActivityNode): Point => ({ x: n.x + n.width / 2, y: n.y });
  const slots = new Map<string, number>();
  // A vertical run takes the next free track in a lane's side gutter.
  const gutter = (lane: number, side: "left" | "right") => {
    const key = `${lane}:${side}`,
      slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    const offset = GUTTER + slot * 4;
    return side === "left" ? laneX + lane * LANE + offset : laneX + (lane + 1) * LANE - offset;
  };
  const straight = (id: string, a: ActivityNode, b: ActivityNode) =>
    edges.push({ id, points: [bottom(a), top(b)] });
  const lettered = new Map<ActivityNode, number>();
  const connect = (
    id: string,
    a: ActivityNode,
    b: ActivityNode,
    transition?: ScenarioTransition,
  ) => {
    const lines = transition ? guard(transition) : [];
    const from = bottom(a),
      to = top(b);
    // A guarded way's run passes under its guard, which sits under the guards
    // of the ways lettered before it.
    const above = lettered.get(a) ?? 0;
    lettered.set(a, above + lines.length);
    const channelOut = from.y + 12 + LINE * (above + lines.length),
      channelIn = b.y - GAP + 12;
    const label = lines.length ? { x: from.x + 8, y: from.y + LINE * (above + 1) + 2, lines } : undefined;
    if (row.get(b)! === row.get(a)! + 1)
      edges.push({
        id,
        transition,
        label,
        points:
          from.x === to.x
            ? [from, to]
            : [from, { x: from.x, y: channelIn }, { x: to.x, y: channelIn }, to],
      });
    else {
      const x =
        b.lane > a.lane
          ? gutter(b.lane, "left")
          : gutter(b.lane, "right");
      edges.push({
        id,
        transition,
        label,
        points: [
          from,
          { x: from.x, y: channelOut },
          { x, y: channelOut },
          { x, y: channelIn },
          { x: to.x, y: channelIn },
          to,
        ],
      });
    }
  };
  if (entry) {
    const first = into(entry.id);
    const trigger = at.get("trigger");
    straight("start", at.get("initial")!, trigger ?? first);
    if (trigger) straight("trigger", trigger, first);
  }
  for (const step of model.steps) {
    const action = at.get(`action:${step.id}`)!;
    const merge = at.get(`merge:${step.id}`),
      decision = at.get(`decision:${step.id}`),
      final = at.get(`final:${step.id}`);
    if (merge) straight(`${merge.id}:out`, merge, action);
    if (decision) straight(`${decision.id}:in`, action, decision);
    if (final) straight(`${final.id}:in`, action, final);
  }
  for (const t of model.transitions) {
    const a = outOf(t.from),
      b = into(t.to);
    if (!t.back) {
      connect(t.key, a, b, t);
      continue;
    }
    // A loop leaves the side of its decision and climbs a gutter to the
    // merge node in front of the step it repeats.
    const x = gutter(Math.max(a.lane, b.lane), "right");
    const sy = a.y + a.height / 2,
      ty = b.y + b.height / 2;
    edges.push({
      id: t.key,
      transition: t,
      points: [
        { x: a.x + a.width, y: sy },
        { x, y: sy },
        { x, y: ty },
        { x: b.x + b.width, y: ty },
      ],
      label: t.condition
        ? { x: a.x + a.width + 6, y: sy - 8 - LINE, lines: wrapText(`[${t.condition}]`, 22, 2) }
        : undefined,
    });
  }

  // The notes sit in a row under the lanes, where a drawing of any width
  // keeps them in reach.
  const notes: ActivityLayout["notes"] = [];
  const noteY = laneBottom + 24;
  let noteX = laneX;
  const note = (title: string, items: string[]) => {
    const lines = items.flatMap((item) => wrapText(item, 34, 4));
    if (!lines.length) return;
    notes.push({ x: noteX, y: noteY, width: NOTE, height: 30 + LINE * (lines.length + 1), title, lines });
    noteX += NOTE + 16;
  };
  note("«precondition»", model.preconditions);
  note(
    "Possible failures",
    model.errors.length
      ? [...model.errors.map((e) => `• ${e}`), ...(model.recovery ? [`Recovery: ${model.recovery}`] : [])]
      : [],
  );
  if (model.inferred)
    note("Read from source", [
      "This flow was read from cited code, not designed or run. Its order is not confirmed.",
    ]);
  const right = Math.max(
    laneX + lanes.length * LANE,
    frameX + tag.width,
    ...notes.map((n) => n.x + n.width),
  );
  const frameBottom =
    (notes.length ? noteY + Math.max(...notes.map((n) => n.height)) : laneBottom) + 16;
  const frame = { x: frameX, y: frameY, width: right + 16 - frameX, height: frameBottom - frameY };
  return {
    frame,
    tag: { text: tagText, path: tag.path },
    lanes,
    laneTop,
    headerHeight,
    laneBottom,
    nodes,
    edges,
    notes,
    viewBox: { x: 0, y: 0, width: frame.x + frame.width + 16, height: frame.y + frame.height + 16 },
  };
}

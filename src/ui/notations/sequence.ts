import { clip, frameTag, textWidth, wrapText } from "./geometry.ts";
import type { Block, ScenarioModel, ScenarioStep } from "./scenario.ts";
import type { FlowMessage, Point, Rect } from "./types.ts";

// A scenario as a UML sequence diagram. A part is a lifeline; a step is an
// execution on its part's lifeline. The flow starts with a found message, the
// trigger, from outside the diagram. A transition into a part not yet at work
// is a synchronous call, named after the step it asks for, and that part stays
// at work until the flow returns to a part that called it, when each part on
// the way back replies to its caller with its outcome. Branches are alt
// fragments, a way that ends on its own is a break, a repeat is a loop: each
// with its condition as the guard. A flow's recorded messages replace the
// transition between the same two steps, with their own name and kind.
export interface SequenceArrow {
  /** Transition key, or the recorded message's key. */
  id: string;
  points: Point[];
  label: { x: number; y: number; lines: string[]; anchor: "start" | "middle" };
  kind: "synchronous" | "asynchronous" | "reply" | "found";
  /** A transition's kind (success, failure, recovery, next), for its colour. */
  tone: string;
  transition?: string;
  message?: FlowMessage;
}
export interface SequenceFragment extends Rect {
  operator: "alt" | "break" | "loop";
  /** Each operand's top, with its guard. */
  operands: { y: number; guard: string }[];
}
export interface SequenceLayout {
  frame: Rect;
  tag: { text: string; path: string };
  lifelines: { part: string; head: Rect; lines: string[]; x: number }[];
  bottom: number;
  executions: (Rect & { step: string })[];
  arrows: SequenceArrow[];
  fragments: SequenceFragment[];
  notes: (Rect & { title: string; lines: string[] })[];
  viewBox: Rect;
}

const SPACING = 240,
  HEAD = { width: 190, height: 52 },
  LINE = 15,
  ROW = 20,
  SELF = 40,
  NOTE = 250;

export function sequenceLayout(
  model: ScenarioModel,
  partTitle: (id: string) => string,
): SequenceLayout {
  const frameX = 16,
    frameY = 16;
  const tagText = `sd ${clip(model.scenario.title, 72)}`;
  const tag = frameTag(frameX, frameY, tagText);
  const firstX = frameX + 230;
  const lane = new Map(model.parts.map((p, i) => [p, firstX + i * SPACING]));
  const headTop = frameY + tag.height + 18;
  const lifelines = model.parts.map((part) => {
    const x = lane.get(part)!;
    return {
      part,
      x,
      lines: wrapText(part ? partTitle(part) : "No part recorded", 26, 2),
      head: { x: x - HEAD.width / 2, y: headTop, ...HEAD },
    };
  });
  const step = new Map(model.steps.map((s) => [s.id, s]));
  const byKey = new Map(model.transitions.map((t) => [t.key, t]));
  const xOf = (s: ScenarioStep) => lane.get(s.part)!;
  // A recorded message between two steps names the call those steps make.
  const recorded = new Map(
    model.messages.map((m) => [`${m.send}>${m.receive}`, m]),
  );

  let y = headTop + HEAD.height + 28;
  const arrows: SequenceArrow[] = [];
  const fragments: SequenceFragment[] = [];
  const reached = new Map<string, number>(),
    left = new Map<string, number>();
  const used = new Map<SequenceFragment, Set<number>>();
  const open: SequenceFragment[] = [];
  const touch = (...xs: number[]) => open.forEach((f) => xs.forEach((x) => used.get(f)!.add(x)));
  const arrow = (
    id: string,
    from: ScenarioStep | null,
    to: ScenarioStep,
    text: string,
    kind: SequenceArrow["kind"],
    tone: string,
    extra: Partial<SequenceArrow> = {},
  ) => {
    const tx = xOf(to);
    const fx = from ? xOf(from) : tx - 200;
    const self = from !== null && fx === tx;
    // A self message's label stays short of the next lifeline.
    const width = self ? 160 : Math.max(Math.abs(tx - fx) - 24, 120);
    const lines = wrapText(text, Math.floor(width / 7), 2);
    y += LINE * lines.length + 4;
    const points = self
      ? [
          { x: fx + 5, y },
          { x: fx + SELF, y },
          { x: fx + SELF, y: y + 16 },
          { x: fx + 5, y: y + 16 },
        ]
      : [
          { x: fx, y },
          { x: tx + (tx > fx ? -5 : 5), y },
        ];
    arrows.push({
      id,
      points,
      kind,
      tone,
      label: self
        ? { x: fx + SELF + 6, y: y + 4, lines, anchor: "start" }
        : { x: (fx + tx) / 2, y: y - 6 - LINE * (lines.length - 1), lines, anchor: "middle" },
      ...extra,
    });
    if (from) left.set(from.id, y);
    // A caller is still at work when the reply reaches it.
    if (kind === "reply") left.set(to.id, y);
    if (!reached.has(to.id)) reached.set(to.id, y + (self ? 16 : 0));
    touch(fx, tx, ...(self ? [fx + SELF + textWidth(lines[0] ?? "")] : []));
    y += self ? 16 + ROW : ROW;
  };
  // The steps of the parts at work, the caller before the called.
  let stack: ScenarioStep[] = [];
  const reply = (done: ScenarioStep, caller: ScenarioStep, transition?: string) =>
    arrow(
      `${transition ?? `${model.scenario.id}:reply:${done.id}>${caller.id}`}:reply`,
      done,
      caller,
      done.outcome,
      "reply",
      "next",
      transition ? { transition } : {},
    );
  const message = (key: string) => {
    const t = byKey.get(key)!;
    const from = step.get(t.from)!,
      to = step.get(t.to)!;
    const m = recorded.get(`${t.from}>${t.to}`);
    const depth = stack.findIndex((s) => s.part === to.part);
    if (m) arrow(key, from, to, m.label, m.kind, t.kind, { transition: key, message: m });
    else if (from.part === to.part)
      arrow(key, from, to, to.action, "synchronous", t.kind, { transition: key });
    else if (depth >= 0 && depth < stack.length - 1) {
      // The flow returns up the chain: each part done replies to its caller,
      // and the caller goes on with the step, named as a message to itself.
      while (stack.length - 1 > depth) {
        const done = stack.pop()!;
        reply(done, stack[stack.length - 1], stack.length - 1 === depth ? key : undefined);
      }
      arrow(`${key}:on`, stack[stack.length - 1], to, to.action, "synchronous", t.kind, { transition: key });
    } else {
      arrow(key, from, to, to.action, "synchronous", t.kind, { transition: key });
      stack.push(to);
      return;
    }
    stack[stack.length - 1] = to;
  };
  const others = (s: ScenarioStep) =>
    model.messages.forEach((m) => {
      if (m.send !== s.id || recorded.get(`${m.send}>${m.receive}`) !== m) return;
      if (model.transitions.some((t) => t.from === m.send && t.to === m.receive)) return;
      arrow(`${model.scenario.id}:message:${m.id}`, s, step.get(m.receive)!, m.label, m.kind, m.kind, { message: m });
    });
  const fragment = (operator: SequenceFragment["operator"], parts: { guard: string; blocks: Block[] }[]) => {
    const f: SequenceFragment = { operator, operands: [], x: 0, y, width: 0, height: 0 };
    used.set(f, new Set());
    open.push(f);
    y += 26;
    // Each operand starts from the parts at work as the fragment is entered.
    const entered = [...stack];
    parts.forEach((part, i) => {
      if (i) y += 10;
      f.operands.push({ y: i ? y - 10 : f.y, guard: part.guard ? `[${clip(part.guard, 40)}]` : "" });
      y += 6;
      stack = [...entered];
      walk(part.blocks);
    });
    y += 8;
    open.pop();
    f.height = y - f.y;
    fragments.push(f);
    y += 14;
  };
  const walk = (blocks: Block[]) => {
    for (const b of blocks)
      if (b.kind === "step") {
        touch(xOf(step.get(b.step)!));
        others(step.get(b.step)!);
      } else if (b.kind === "message") message(b.transition);
      else if (b.kind === "alt") fragment("alt", b.operands);
      else fragment(b.kind, [{ guard: b.guard, blocks: b.blocks }]);
  };
  const entry = model.steps[0];
  if (entry) {
    arrow(`${model.scenario.id}:found`, null, entry, model.trigger || entry.action, "found", "next");
    stack = [entry];
    if (model.blocks) walk(model.blocks);
    else
      for (const s of model.steps) {
        others(s);
        for (const t of model.transitions.filter((t) => t.from === s.id && !t.back))
          message(t.key);
      }
    // The flow over, every part still at work replies to its caller.
    while (stack.length > 1) {
      const done = stack.pop()!;
      reply(done, stack[stack.length - 1]);
    }
  }
  for (const f of fragments) {
    const xs = [...used.get(f)!];
    const depth = fragments.filter((o) => o !== f && o.y < f.y && o.y + o.height > f.y + f.height).length;
    const pad = Math.max(70 - depth * 12, 16);
    f.x = Math.min(...xs) - pad;
    f.width = Math.max(Math.max(...xs) + pad - f.x, textWidth(f.operands[0]?.guard ?? "") + 90);
  }
  // An execution that starts while another on the same lifeline is still
  // running is nested in it, drawn a step to the right as UML does.
  const executions: SequenceLayout["executions"] = [];
  for (const s of [...model.steps].sort((a, b) => (reached.get(a.id) ?? 0) - (reached.get(b.id) ?? 0))) {
    const start = reached.get(s.id);
    if (start === undefined) continue;
    const end = Math.max(left.get(s.id) ?? 0, start + 22);
    const depth = executions.filter(
      (e) => e.x <= xOf(s) + 12 && e.x >= xOf(s) - 5 && e.y + e.height > start,
    ).length;
    executions.push({ step: s.key, x: xOf(s) - 5 + depth * 6, y: start, width: 10, height: end - start });
  }
  // The lifelines end where the flow does; the notes sit in a row under them,
  // where a drawing of any width keeps them in reach.
  const lifelineBottom = y + 20;
  const notes: SequenceLayout["notes"] = [];
  const noteY = lifelineBottom + 24;
  let noteX = firstX - HEAD.width / 2;
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
    note("Read from source", ["This flow was read from cited code, not designed or run. Its order is not confirmed."]);
  const bottom = notes.length ? noteY + Math.max(...notes.map((n) => n.height)) : lifelineBottom;
  const right = Math.max(
    frameX + tag.width,
    ...lifelines.map((l) => l.head.x + l.head.width),
    ...fragments.map((f) => f.x + f.width),
    ...arrows.flatMap((a) => a.points.map((p) => p.x + (a.label.anchor === "start" ? textWidth(a.label.lines[0] ?? "") + 10 : 0))),
    ...notes.map((n) => n.x + n.width),
  );
  const frame = { x: frameX, y: frameY, width: right + 20 - frameX, height: bottom + 16 - frameY };
  return {
    frame,
    tag: { text: tagText, path: tag.path },
    lifelines,
    bottom: lifelineBottom,
    executions,
    arrows,
    fragments,
    notes,
    viewBox: { x: 0, y: 0, width: frame.x + frame.width + 16, height: frame.y + frame.height + 16 },
  };
}

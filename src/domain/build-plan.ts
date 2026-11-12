import { shapeName, type Document, type PlanningRecord } from "./records.ts";
import type { WorkRoute } from "./work-automation.ts";

// Whether the plan is ready to build, from the plan alone. A lead session
// builds it with subagents, and all of them read the owner's own words and
// the plan, so the plan holds the design those words do not: every component
// its contract, files and the model that builds it, the lead's model, the
// project's architecture, one agreed shape for each record several components
// write, and no question left open.

export type BuildPlan = {
  /** Anything that stops a build from starting. */
  problems: string[];
  /** Things worth knowing that do not block. */
  notes: string[];
  ready: boolean;
};

const active = (r: PlanningRecord) => r.status !== "superseded";

/**
 * The components a build builds: the project's own, without the people
 * and outside systems the plan shows around it, and without the systems and
 * containers that only group other components. One that other parts sit
 * inside and that plans files of its own, such as a server with its entry
 * point, is built like any other.
 */
export function builtComponents(doc: Document) {
  const internal = doc.records.filter(
    (r) =>
      r.kind === "component" &&
      active(r) &&
      !r.data.c4?.external &&
      r.data.c4?.level !== "person",
  );
  const parents = new Set(internal.map((r) => r.data.parent).filter(Boolean));
  return internal.filter((r) => !parents.has(r.id) || r.data.contract?.sourceTargets.length);
}

/** A draft decision that would replace one the owner accepted. */
export type Replacement = {
  id: string;
  title: string;
  replaces: { id: string; title: string };
};

/**
 * The draft decisions that would replace one the owner accepted. Only the
 * owner changes an accepted decision: the owner's go for the next build
 * accepts each replacement, so the planner names them to the owner first;
 * otherwise a planner can read an owner's "choose what you judge
 * appropriate" as consent to drop a standing decision.
 */
export function replacements(doc: Document): Replacement[] {
  const byId = new Map(doc.records.map((r) => [r.id, r]));
  return doc.records
    .filter((r) => r.kind === "decision" && r.status === "draft" && r.data.supersedes)
    .flatMap((r) => {
      const replaced = byId.get(r.data.supersedes);
      if (replaced?.kind !== "decision" || replaced.status !== "accepted") return [];
      return [{ id: r.id, title: r.title, replaces: { id: replaced.id, title: replaced.title } }];
    });
}

/**
 * The models the plan builds its components on, each once: the planner
 * decides which model builds each component.
 */
export function componentModels(doc: Document): WorkRoute[] {
  const routes = new Map<string, WorkRoute>();
  for (const c of builtComponents(doc))
    if (c.data.build) routes.set(`${c.data.build.model} ${c.data.build.thinking}`, c.data.build);
  return [...routes.values()];
}

/**
 * Components without the contract, files and model a build builds them from,
 * or using a component the plan dropped.
 */
function incompleteComponents(doc: Document, built: PlanningRecord[], problems: string[]) {
  const byId = new Map(doc.records.map((r) => [r.id, r]));
  for (const c of built) {
    if (!c.data.build)
      problems.push(
        `Component "${c.title}" (${c.id}) has no model to build it: give it data.build:{model,thinking}.`,
      );
    const contract = c.data.contract;
    if (!contract)
      problems.push(
        `Component "${c.title}" (${c.id}) has no contract: give it its files and what it uses.`,
      );
    else if (!contract.sourceTargets.length)
      problems.push(`Component "${c.title}" (${c.id}) plans no files (contract.sourceTargets).`);
    for (const used of contract?.allowedDependencies ?? [])
      if (byId.get(used)?.status === "superseded")
        problems.push(`Component "${c.title}" (${c.id}) uses ${used}, which the plan superseded.`);
  }
}

/**
 * Records written by more than one component need one agreed shape, or the
 * code that writes them disagrees about it. A name in contract.writes that
 * another component also writes or owns, with no interface shape, blocks
 * the build; identical owns entries alone are only noted.
 */
function sharedData(
  doc: Document,
  built: PlanningRecord[],
  problems: string[],
  notes: string[],
) {
  const names = new Map<string, { name: string; writers: Set<string>; declared: boolean }>();
  for (const r of built) {
    const c = r.data.contract;
    for (const [list, declared] of [
      [c?.writes ?? [], true],
      [c?.owns ?? [], false],
    ] as const)
      for (const name of list) {
        const key = shapeName(name);
        const entry = names.get(key) ?? { name, writers: new Set<string>(), declared: false };
        entry.writers.add(r.id);
        entry.declared ||= declared;
        names.set(key, entry);
      }
  }
  const shaped = new Set(
    doc.records
      .filter((r) => r.kind === "interface" && active(r))
      .flatMap((r) => (r.data.shapes ?? []).map((s: any) => shapeName(s.name))),
  );
  for (const [key, w] of names) {
    if (w.writers.size < 2 || shaped.has(key)) continue;
    const text = `"${w.name}" is written by ${[...w.writers].join(", ")}, but no interface defines its shape.`;
    if (w.declared)
      problems.push(
        `${text} Add the agreed fields to an interface they use (interface.data.shapes), or give it a single writer.`,
      );
    else notes.push(`${text} If they really share it, give it one agreed shape in an interface.`);
  }
}

/** The decisions that name the model the build's lead runs on. */
const leadDecisions = (doc: Document) =>
  doc.records.filter((r) => r.kind === "decision" && active(r) && r.data.lead);

/** The model the build's lead runs on, which the planner decides as it does the components' models. */
export function leadRoute(doc: Document): WorkRoute | undefined {
  return leadDecisions(doc)[0]?.data.lead;
}

/** The decisions that set the project's architecture. */
const architectureDecisions = (doc: Document) =>
  doc.records.filter((r) => r.kind === "decision" && active(r) && r.data.architecture);

/**
 * The decision that sets the project's structure. The lead writes the
 * foundation to it and every part follows it, so the structure is the
 * owner's and the planner's choice rather than whatever is written first.
 */
export function architectureDecision(doc: Document): PlanningRecord | undefined {
  return architectureDecisions(doc)[0];
}

export function buildPlan(doc: Document): BuildPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const built = builtComponents(doc);
  if (!built.length) problems.push("The plan has no components to build yet.");
  incompleteComponents(doc, built, problems);
  const leads = leadDecisions(doc);
  if (!leads.length)
    problems.push("No decision names the model that leads the build: record one with data.lead:{model,thinking}.");
  if (leads.length > 1)
    problems.push(`Decisions ${leads.map((r) => `"${r.title}" (${r.id})`).join(", ")} each name the build's lead: keep one.`);
  const architectures = architectureDecisions(doc);
  if (!architectures.length)
    problems.push(
      "No decision sets the project's architecture: record one with data.architecture:{style,dependencies,state,errors}, sized to the project, and name it to the owner before the go.",
    );
  if (architectures.length > 1)
    problems.push(
      `Decisions ${architectures.map((r) => `"${r.title}" (${r.id})`).join(", ")} each set the project's architecture: keep one.`,
    );
  sharedData(doc, built, problems, notes);
  for (const q of doc.records.filter((r) => r.kind === "question" && active(r)))
    problems.push(
      `Question "${q.title}" (${q.id}) is still open: settle it with the owner and remove the question.`,
    );
  for (const change of replacements(doc))
    notes.push(
      `Decision "${change.title}" would replace "${change.replaces.title}", which the owner accepted: the owner's go for the next build accepts the replacement, so name it to the owner before they give it.`,
    );
  return { problems, notes, ready: !problems.length };
}

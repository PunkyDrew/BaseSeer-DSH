import { architectureDecision, builtComponents } from "../../../domain/build-plan.ts";
import type { Document, PlanningRecord } from "../../../domain/records.ts";
import type { WorkRoute } from "../../../domain/work-automation.ts";

// How the plan appears in a subagent's instructions: the summary of the map
// it reads the plan from, and each record as compact JSON it can read exactly.

const json = (value: unknown) => JSON.stringify(value);

/** The model a component is planned on, as the lead starts a subagent on it. */
export const builtOn = (route: WorkRoute) => `${route.model} (${route.thinking})`;

const live = (r?: PlanningRecord): r is PlanningRecord =>
  !!r && r.status !== "superseded";

function componentText(c: PlanningRecord) {
  const d = c.data;
  return json({
    id: c.id,
    title: c.title,
    ...(d.technology ? { technology: d.technology } : {}),
    ...(d.responsibility ? { responsibility: d.responsibility } : {}),
    ...(d.parent ? { parent: d.parent } : {}),
    ...(d.contract
      ? {
          contract: {
            inputs: d.contract.inputs,
            outputs: d.contract.outputs,
            owns: d.contract.owns,
            mayUse: d.contract.allowedDependencies,
            files: d.contract.sourceTargets,
            ...(d.contract.writes ? { sharedWrites: d.contract.writes } : {}),
          },
        }
      : {}),
    ...(d.screen ? { screen: d.screen } : {}),
    ...(d.build ? { builtOn: builtOn(d.build) } : {}),
  });
}

export function recordText(r: PlanningRecord) {
  if (r.kind === "component") return componentText(r);
  if (r.kind === "interface")
    return json({
      interface: r.id,
      title: r.title,
      responsibility: r.data.responsibility,
      format: r.data.format,
      ...(r.data.shapes ? { shapes: r.data.shapes } : {}),
    });
  if (r.kind === "requirement")
    return json({
      requirement: r.id,
      title: r.title,
      priority: r.data.priority,
    });
  if (r.kind === "scenario")
    return json({
      scenario: r.id,
      title: r.title,
      trigger: r.data.trigger,
      steps: (r.data.steps ?? []).map(
        (s: any) =>
          `${s.component ? `[${s.component}] ` : ""}${s.action} → ${s.outcome}`,
      ),
      errors: r.data.errors,
    });
  if (r.kind === "decision") return json({ decision: r.id, title: r.title, choice: r.data.choice });
  return json({ [r.kind]: r.id, title: r.title });
}

/**
 * The project's architecture, in full for every session of a build. The
 * other decisions reach a subagent through the lead, where they bear on its
 * part; this one bears on every part, and code written without it settles
 * the structure by whichever part is written first.
 */
export function architectureText(doc: Document) {
  const decision = architectureDecision(doc);
  if (!decision) return "";
  const a = decision.data.architecture;
  return `The project's architecture, which the owner accepted with the go (decision ${decision.id}); build to it, and where your part cannot, say so in your report rather than build around it:
- Structure: ${a.style}
- Dependencies: ${a.dependencies} Each component's "uses" in the map follows this, and BaseSeer's check fails an import between components the plan does not allow.
- State: ${a.state}
- Errors: ${a.errors}`;
}

const indexLines = (doc: Document, kind: string) =>
  doc.records
    .filter((r) => r.kind === kind && live(r))
    .map((r) => `- ${r.id}: ${r.title}`);

/**
 * The summary of the map in a subagent's instructions: every component the
 * build builds with its files, what it uses and the model it is built on,
 * and the other records by name. A subagent reads each record exactly with
 * plan_map when it builds from it. The decisions are the planner's design
 * choices, which the lead tells each subagent where they matter: given to
 * every subagent in full, each reads as an order to build to the letter.
 */
export function mapSummary(doc: Document) {
  const components = builtComponents(doc).map((c) => {
    const contract = c.data.contract;
    const uses = contract?.allowedDependencies.length ? `; uses ${contract.allowedDependencies.join(", ")}` : "";
    const screen = c.data.screen ? "; renders a planned screen" : "";
    const model = c.data.build ? `; built on ${builtOn(c.data.build)}` : "";
    return `- ${c.id}: ${c.title}${c.data.responsibility ? ` (${c.data.responsibility})` : ""}; files ${contract?.sourceTargets.join(", ") || "none planned"}${uses}${screen}${model}`;
  });
  const sections: [string, string[]][] = [
    ["Components", components],
    ["Interfaces and agreed record shapes", indexLines(doc, "interface")],
    ["Requirements", indexLines(doc, "requirement")],
    ["Scenarios", indexLines(doc, "scenario")],
    ["Decisions", indexLines(doc, "decision")],
  ];
  return sections
    .filter(([, lines]) => lines.length)
    .map(([heading, lines]) => `${heading}:\n${lines.join("\n")}`)
    .join("\n\n");
}

import type { Generation } from "../contracts/generation.ts";

export function generationSummary(run: Generation) {
  if (run.assessmentState === "stale")
    return "Coverage out of date — saved records have changed; review them before relying on the assessment.";
  if (!run.assessment)
    return "Coverage unassessed — finishing generation does not establish how much of the project is explained.";
  const a = run.assessment;
  const represented = a.operations.filter(
    (o) => o.selected && o.scenarios.length,
  ).length;
  const selected = a.operations.filter((o) => o.selected).length;
  const remaining =
    a.operations.filter((o) => !o.scenarios.length).length +
    a.deferredOperations;
  return `${a.state === "representative" ? "Selected operations represented" : a.state === "partial" ? "Partial draft" : "Unassessed operations"} · ${represented} of ${selected} selected operations have flows; ${remaining} known candidates remain unexplained. Runtime behavior is unverified.`;
}

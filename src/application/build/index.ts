// A whole-project build: on the owner's go, a lead session builds the project
// from its plan with subagents in the project folder, until BaseSeer's
// acceptance check passes. Once the project is built, a build changes what
// changed in the plan since.
export * from "./model.ts";
export { BuildRuns, type CheckResult } from "./runs.ts";

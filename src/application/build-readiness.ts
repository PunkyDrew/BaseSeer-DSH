import type { Document } from "../domain/records.ts";
import { buildPlan } from "../domain/build-plan.ts";

/** Compact build readiness for planner reads and write receipts. */
export function buildReadiness(doc: Document) {
  const plan = buildPlan(doc);
  return {
    ready: plan.ready,
    ...(plan.problems.length ? { problems: plan.problems } : {}),
    ...(plan.notes.length ? { notes: plan.notes } : {}),
    instruction: plan.ready
      ? "The plan is ready to build. Show the owner what it will build and on which models, and each decision you took from what you found on this machine rather than from their words (an address, a device, a tool), since the build relies on it; then tell them to type /baseseer build in this chat when they want it built."
      : "Before you answer the owner, fix the listed problems, or tell the owner what only they can settle; notes are informational.",
  };
}

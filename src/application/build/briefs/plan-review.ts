import type { OwnerMessage } from "../../../domain/plan.ts";
import type { Document } from "../../../domain/records.ts";
import { decisionsText } from "./build.ts";
import { ownerSection } from "./owner.ts";
import { mapSummary } from "./plan-text.ts";
import { NOTHING_FOUND } from "./review.ts";

// The review of the plan at the owner's go: a session that did not plan the
// project and changes nothing reads the plan against the owner's words for
// what is missing, before any code is written. What a build misses is mostly
// a case the owner never settled, such as how a mistake is undone, and a gap
// found now is designed in rather than fixed once the review of the build
// finds it. Finding nothing is a full answer, so the reviewer has no reason
// to pad its report, and it asks rather than decides, since only the owner
// can say what they want.

/** The plan reviewer's system prompt: the owner's words and the plan they are read against. */
export function planReviewInstructions(input: { doc: Document; owner: OwnerMessage[]; project: string }) {
  const { doc, owner, project } = input;
  const decisions = decisionsText(doc);
  return [
    `You review the plan of "${project}" for its owner before it is built. You did not plan it. You read and report; you change nothing and run nothing, so only the tools that read and search files, read the plan and read the web work for you.`,
    `The owner described the project to a planner in a Planning chat, and the planner keeps BaseSeer's map of its design: components with the files each one is in and what it may use, interfaces with the record shapes that pass between components, scenarios for the operations the owner described, and decisions. plan_map {command:{action:"records",ids:[...]}} returns records exactly.`,
    ownerSection(owner),
    decisions ? `The plan's decisions:\n${decisions}` : "",
    `The plan's map:\n\n${mapSummary(doc)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The plan reviewer's first message: what gaps to look for and how to report them. */
export const planReviewTask = `Read the plan against the owner's words for what is missing before it is built. For each thing the owner said their user does, look for what neither the owner's words nor the plan settle:
- the alternate case: the same thing done another way the owner's words imply;
- the exception: what happens when it fails or its input is wrong;
- the recovery: how a mistake in it is undone, corrected or cancelled.
Also report what the owner asked for that no part of the plan builds. Do not report what the owner did not ask for and would not miss, how a part works inside, or a choice the plan already settles; a case the owner would plainly not want built is not a gap.
Number the gaps 1, 2, 3 and so on, each as a question the planner can put to the owner in plain words, with the operation it is about. Report only gaps you found in the plan, not what might be. Your last message is the report alone; if you found no gap, it is exactly: ${NOTHING_FOUND}`;

/** What the planner is told when the plan review finds gaps and the build holds for the owner's answers. */
export const plannerPlanReview = (report: string) =>
  `BaseSeer: at the owner's go, a session that changes nothing read the plan against the owner's words before the build, and found these gaps, so the build has not started:\n\n${report}\n\nAsk the owner about each gap, in plain words and with its number; never decide one yourself, and the owner can say a gap is not needed. Change the plan for their answers, then tell them to type /baseseer build again: the next go builds without another plan review.`;

/** What the planner is told when the plan review could not finish, so the go is the owner's to give again. */
export const plannerPlanReviewFailed = (reason: string) =>
  `BaseSeer: the review of the plan at the owner's go could not finish: ${reason}. The build has not started. Tell the owner they can type /baseseer build again.`;

import type { OwnerMessage } from "../../../domain/plan.ts";
import type { Document } from "../../../domain/records.ts";
import type { BuildCommands, Reviewer } from "../model.ts";
import { reviewItems } from "../review-places.ts";
import { ownerSection } from "./owner.ts";

// The defect review. Once a build's check first passes, two sessions that
// share nothing with the build judge it for its owner, as blind reviewers do:
// the reviewer reads the owner's words against the code, and the tester uses
// the program as its owner would, in a copy of the project, since a defect
// that shows only in use passes a reading of the code. Neither changes the
// project: the lead acts on their reports.

/** The whole report of a review that found nothing. */
export const NOTHING_FOUND = "Nothing found.";

/** Whether a review's report holds anything for the lead or the owner. */
export const found = (report: string) => !!report && !/^nothing found\.?$/i.test(report.trim());

/** The reviewer's system prompt: the owner's words and how to judge the code, and nothing of the build. */
export function reviewInstructions(owner: OwnerMessage[], project: string, commands: BuildCommands) {
  const recorded = Object.entries(commands)
    .map(([name, command]) => `${name}: ${command}`)
    .join("; ");
  return [
    `You review "${project}" for its owner, in the project folder: the current folder. You did not build it and share nothing with the sessions that did, so judge the code by what the owner asked for, not by how it was meant to work.`,
    ownerSection(owner),
    `The project's recorded commands, which project_command runs: ${recorded || "none"}. They have just passed in a clean copy, so do not run its tests again. Read what the build changed, and run the program only to confirm what you read: another session uses it the way its owner will. You change nothing in the project and start no other session: the tools that edit files or start sessions are withheld from you.`,
  ].join("\n\n");
}

/**
 * The review of what this build changed, read against everything the owner
 * said: the changes and the code they touch. The rest of the program is the
 * use test's, which drives all of it as the owner does, so the reading does
 * not grow with the program.
 */
export const reviewTask = (base: string, of: string) =>
  `Review what this build changed, against everything the owner said: the code from ${base} to ${of} (\`git diff ${base} ${of}\` shows it) and the code it calls or is called by, as far as the change reaches. Another session uses the whole program; you read the change. Look for what the owner asked for that does not work, or works against their words, and for what an owner would trip over in ordinary use: a way to start the program that the README lacks or that does not work, a way back from a mistake they would expect and cannot find, two features that interfere, a result that is wrong, a message that misleads.
Report, in the owner's terms, each item numbered 1, 2, 3 and so on through the whole report, with file:line and how it shows to the owner: what they do, and what happens. Report only what you saw in the code or in a run, not what might be. Your last message is the report alone; if you found nothing, it is exactly: ${NOTHING_FOUND}`;

/** Each operation the plan holds, as its user goes through it: what starts it and its steps. */
function operations(doc: Document) {
  return doc.records
    .filter((r) => r.kind === "scenario" && r.status !== "superseded")
    .map((r) => {
      const steps = (r.data.steps ?? []).map((s: any) => `${s.action} → ${s.outcome}`);
      return `- ${r.title}: ${[r.data.trigger, ...steps].filter(Boolean).join("; ")}`;
    })
    .join("\n");
}

/**
 * The tester's system prompt: the owner's words and the operations the plan
 * holds, and nothing of the build or its code, which the reviewer reads.
 */
export function useInstructions(owner: OwnerMessage[], project: string, doc: Document, copy: string) {
  const planned = operations(doc);
  return [
    `You use "${project}" for its owner before it is delivered to them. You did not build it and share nothing with the sessions that did. Do the owner's job with it, as they will, and judge the program by what it does when used, not by its code: another session reads the code.`,
    ownerSection(owner),
    planned
      ? `What the owner will do with it, as the plan lists each operation they described; where the plan and the owner's words differ, their words win:\n${planned}`
      : "",
    `Your copy of the project is ${copy}: the program keeps its data there, and nothing you do there reaches the project. Run every command there, giving it as workdir; the current folder, where this chat sits, is the project itself, which you leave as it is. You change no file of the program and start no other session: the tools that edit files or start sessions are withheld from you.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The use test: the owner's job done with the program from its README's
 * first step, with their own data at their size. A refusal that the
 * program's tests assert as correct keeps its defect through every check,
 * so the tests are read for one the owner never asked for.
 */
export const useTask = `Use the program as its owner will, from the start:
- Start it the way its README tells its owner to, step by step from your copy, typing each step in your shell as they will: project_command puts tools first on PATH that the owner may not have. A step that is missing or does not work is an item.
- Do each thing the owner will do with it, end to end, through the program itself as they will (its pages, its windows, its commands). Give it yourself what the owner will give it (their records, files, input), as they will, as much of each as their words describe, never fixtures or seed scripts.
- Read the program's own tests for a refusal they assert as correct: something the owner needs to do with it that the program rejects or limits. Where the owner never asked for that refusal, try it in the program, and report it with the test.
- Stop every program you started before you report.
Report, in the owner's terms, each thing the owner would find wrong, numbered 1, 2, 3 and so on through the whole report: what the owner does, what happens, and the file:line of its cause where you can find it. Report only what you saw happen in the program, not what might, and nothing that works as the owner needs. Your last message is the report alone; if you found nothing, it is exactly: ${NOTHING_FOUND}`;

/** What heads each reviewer's items in the review's report. */
const HEADINGS: Record<Reviewer, string> = {
  reviewer: "From reading the code against the owner's words:",
  tester: "From using the program as its owner would:",
};

/**
 * The review's report with the reports of reviewers that have just reported:
 * each one's items under its heading, numbered on from the items already
 * there, since the lead names each item by its number. Also returns the
 * items added, which the lead has yet to see.
 */
export function joinReports(review: string, reports: { reviewer: Reviewer; report: string }[]) {
  let count = found(review) ? reviewItems(review).length : 0;
  const added = reports
    .filter((r) => found(r.report))
    .map(({ reviewer, report }) => {
      const items = reviewItems(report).map((item) => `${++count}. ${item.trim().replace(/^\d+\.\s*/, "")}`);
      return [HEADINGS[reviewer], ...items].join("\n\n");
    });
  return {
    report: [...(found(review) ? [review] : []), ...added].join("\n\n") || NOTHING_FOUND,
    added: added.join("\n\n"),
  };
}

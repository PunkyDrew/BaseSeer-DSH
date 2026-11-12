import type { OwnerMessage } from "../../../domain/plan.ts";
import type { Document } from "../../../domain/records.ts";
import type { CodeFindings } from "../code-findings.ts";
import { decisionsText } from "./build.ts";
import { placesToLook, unplannedImportsToLook } from "./findings.ts";
import { codeStandard } from "./guidance.ts";
import { ownerSection } from "./owner.ts";
import { mapSummary } from "./plan-text.ts";
import { found, NOTHING_FOUND } from "./review.ts";

// The validation the owner asks for with /baseseer validate: a session that
// changes nothing reads the whole project against its plan, the owner's
// words and the code standard, and numbers what it finds, so the owner can
// have /baseseer repair fix all of it or the items they choose. One read
// covers what departs from the plan, what is dead and what wants
// restructuring, since each of those needs the whole program read.

/** The validator's system prompt: the plan, the owner's words and the standard the code is held to. */
export function validationInstructions(input: { doc: Document; owner: OwnerMessage[]; project: string }) {
  const { doc, owner, project } = input;
  const decisions = decisionsText(doc);
  return [
    `You validate "${project}" for its owner, in the project folder: the current folder. You read and report; you change nothing and run nothing, so only the tools that read and search files, read the plan and read the web work for you.`,
    `The owner described the project to a planner in a Planning chat, and the planner keeps BaseSeer's map of its design: components with the files each one is in and what it may use, interfaces with the record shapes that pass between components, and decisions. plan_map {command:{action:"records",ids:[...]}} returns records exactly; plan_map {command:{action:"coverage"}} compares each planned component with the files in this folder. Where the map and the owner's words disagree, the owner's words win.`,
    ownerSection(owner),
    decisions ? `The plan's decisions:\n${decisions}` : "",
    `The code standard the project is held to:\n${codeStandard}`,
    `The plan's map:\n\n${mapSummary(doc)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What BaseSeer's source analysis found, as places for the validator to look. */
const places = (findings?: CodeFindings) =>
  findings
    ? [
        ...findings.cycles.map((cycle) => `Source files that import each other at run time: ${cycle.join(" <-> ")}.`),
        ...unplannedImportsToLook(findings),
        ...placesToLook(findings),
      ]
    : [];

/** The validator's first message: what to read and how to report, with what BaseSeer's source analysis found. */
export function validationTask(findings?: CodeFindings) {
  const look = places(findings);
  return `Validate the project: read all of it against the plan, the owner's words and the code standard.${
    look.length
      ? ` BaseSeer's source analysis found these places to look, which may be the plan's fault rather than the code's:\n${look.map((place) => `- ${place}`).join("\n")}`
      : ""
  }
Report three kinds of item:
- where the code departs from the plan: a planned component, file, screen, record shape or decision it does not follow, a part missing or built otherwise, and setup the plan asks for (tooling, commands, a README) that is missing or does not work as it says;
- dead or outdated code: code, files, dependencies, settings and tests that nothing uses any more, what is left of a part the plan no longer has, and code a newer part has replaced;
- where the code breaks the code standard and should be restructured: the same thing done twice or in different ways, a rule worked out in more than one place, a module or function doing several jobs, layers nothing needs.
Number the items 1, 2, 3 and so on through the whole report, each with file:line, what is wrong and what to do about it, and say where the plan rather than the code looks wrong. Report only what you saw in the code, not what might be. Your last message is the report alone; if you found nothing, it is exactly: ${NOTHING_FOUND}`;
}

/** What the planner is told when the validation ends, to tell the owner. */
export const plannerValidation = (report: string) =>
  found(report)
    ? `BaseSeer: the validation the owner asked for with /baseseer validate read the code against the plan and reported:\n\n${report}\n\nTell the owner, in plain words, what it found, item by item with its number. Where an item shows that the plan rather than the code should change, say so and offer to change the plan. Tell the owner that /baseseer repair fixes every item, and /baseseer repair with item numbers (for example /baseseer repair 1 3) fixes only those.`
    : "BaseSeer: the validation the owner asked for with /baseseer validate read the code against the plan and found nothing to repair. Tell the owner.";

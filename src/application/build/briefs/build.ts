import type { OwnerMessage } from "../../../domain/plan.ts";
import type { Document } from "../../../domain/records.ts";
import type { BuildReview, ChangeScope, ReviewPlace } from "../model.ts";
import { headline, reviewItems } from "../review-places.ts";
import { changeSection } from "./change.ts";
import { codeStandard, commandsRule, fewSteps, housekeeping, leadReport, realRuntime, subagentReport } from "./guidance.ts";
import { ownerSection } from "./owner.ts";
import { architectureText, builtOn, mapSummary } from "./plan-text.ts";
import { found } from "./review.ts";

/**
 * How every session of a build learns what to build: from the owner's own
 * words, which say what the project must do, and from BaseSeer's map, which
 * is the design.
 */
const readThePlan = `The owner described this project to a planner in a Planning chat, and the planner keeps BaseSeer's map of its design. The owner's messages, word for word, are below, each answer with the planner's message it answers: they say what the project must do, and a later message can change an earlier one. The map's components carry contracts that name the files each one is in, what it may use, and the records that cross its boundary or that it owns; interfaces carry the agreed record shapes between components. The map does not say how a part works: build that from the owner's words. Where the map and the owner's words disagree, the owner's words win: build what the owner asked, and say in your report where the map said otherwise. Before you build a component, read its record exactly with plan_map {command:{action:"records",ids:[...]}}, with the records it uses; plan_map {command:{action:"coverage"}} shows which planned files exist.`;

/**
 * What every component needs, whether the project is new or already built,
 * and whoever builds it.
 */
const duties = [
  "build each component fully, in its planned files, doing what the owner's words ask of it, with the records and shapes the plan names between the parts and the tests its planned files name. Define each agreed record shape once in shared code, validate it where data is stored or loaded, and use it wherever that record is read or written. Keep each rule in the component that owns it, where everything that needs it calls it;",
  "build each screen for its planned purpose, main action and checks, laid out from the owner's words, with the project's one shared set of components and design tokens, so the screens look and behave as one app;",
  "in a project that is already built, change the code where the plan changed rather than around it, and keep everything else working;",
  "before you report, use what you built the way its user would, and fix what breaks.",
];

const work = `The work:\n${duties.map((duty) => `- ${duty}`).join("\n")}\n${commandsRule}`;

/**
 * What every session the lead starts is told, as its system prompt: the
 * owner's words, how to read the plan, the work, the code standard and the
 * map summary.
 */
export function subagentInstructions(doc: Document, owner: OwnerMessage[], project: string, since?: string) {
  return [
    `You build part of "${project}" for the build's lead, in the project folder: the current folder. The lead tells you which components are yours and what else you need to know.`,
    readThePlan,
    ownerSection(owner, since),
    architectureText(doc),
    work,
    realRuntime,
    codeStandard,
    fewSteps,
    housekeeping,
    subagentReport,
    `The plan's map:\n\n${mapSummary(doc)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What the whole project needs besides its components: a change can bring
 * what the first build did not have, such as the project's first user
 * interface, and it is held to the same work.
 */
const projectWork = [
  "the tooling the project needs (package manifest, dependencies, build and test setup), its recorded commands, and a .gitignore for dependencies, build output, build caches, test-results/ and the data the program saves as it is used, such as its database file (never .baseseer: it holds the project's plan);",
  "if the project has a user interface, end-to-end tests that use it the way its user does, kept apart from the unit tests so each test runner finds only its own files;",
  "a README true to the project: what it does and how its owner starts using it, step by step from the project folder: any tool to install first, the command that starts it, and the address or file it opens, if any. BaseSeer writes its Commands and Code sections, and its use test starts the program from a fresh copy of the project the way the README says;",
  "once the parts are built, someone uses the whole project the way its user would, doing everything the owner asked for end to end, and fixes what breaks.",
];

/**
 * The planner decides which model builds each component, and the lead's
 * subagent tool offers only those models, so a component is built on its
 * planned model by a subagent or by the lead where it runs on that model.
 * The lead builds the foundation itself before any subagent starts: parts
 * started together into an empty folder each find their own way of doing
 * every kind of thing, and settle what passes between them as they go. The
 * foundation is the plan's architecture as code, with every interface
 * between the parts in it, so the parts can be built apart.
 * Its path ends in a whole screen, since a screen is what the other screens'
 * builders copy, forms and all.
 */
const howToBuild = `How to build:
- First build the foundation yourself, in this folder, before any subagent starts: the tooling and the recorded commands, the project's architecture as code (its structure in folders and modules, the direction its dependencies point, its one way of holding state and of carrying a failure to the user), the code several components share (the shared record definitions and the storage), every interface the plan records between parts as real signatures the other parts call, and one complete path through the whole project, until the recorded commands pass here: one record's way from its storage and request to its screen (one the plan builds on your model, where it has one), that screen whole with everything its user does on it, and its unit and end-to-end tests, where the project has them. In a project already built, the foundation is the change to the shared records, the storage and the interfaces between parts. The parts then follow your code: the architecture as it stands in the folder, one way of doing each kind of thing, and real code to call.
- Then start a subagent with the subagent tool for each part of the work that can be built apart, on the model the plan gives its components ("built on" in the map): provider and model from that route ("provider/model"), and reasoning_effort set to its thinking (left out for "default"). Give a subagent only components planned on its model, by their ids in the plan. Build yourself what is planned on your own model and quicker to build than to explain. Split the work so the parts finish together: a part several times larger than the rest is split further, since the slowest part sets the build's time. Start the parts together; each ends with a report to you, which you read before you go on.
- BaseSeer gives every subagent the owner's messages word for word, the code standard, the work every part needs and read-only plan_map, so do not repeat those. Tell each one what is its own, and what it needs that the plan and the owner's words do not say: what the planner and the owner settled, what the other subagents are building alongside it, and the code of yours it follows. What passes between their parts is in your foundation; where one finds a gap in it, the subagents settle it with each other through build_message and name it in their reports.
- When every part is built, call build_check. BaseSeer runs the project's recorded commands in a clean copy of this folder, the way continuous integration would, and returns what fails with its evidence. A check with no recorded test or e2e command does not pass: record one, or, when no test can apply to this project, why, with record_commands. Send each problem to the subagent that built that part (send_message keeps what it already knows) or to a new one, or fix it yourself, then check again.
- Once the check passes, BaseSeer reviews the build with two sessions that share nothing with it: a reviewer reads the owner's words against the code, and a use test uses the program as its owner will, in a copy of the project, and reports what the owner does, what happens and the file:line of the cause where it found one. The check returns their items as one numbered report. The review stands for the owner, so fix every item wherever the program does the same thing, as you would a failure, the ones you would have left alone included; where you think an item was wrong, fix it all the same and say which and why in your report, which the owner reads. Then check again, naming the numbers of the items you fixed. The next passing check completes the build once every item is fixed; a session of the review that could not run is tried again on the next check, its items numbered on after the others, and the build stops rather than complete without both.
- Where only the owner or the planner can decide something, end your turn with the question: BaseSeer gives it to the planner, who asks the owner where it must, and brings you the answer.`;

/** The plan's decisions, which the lead reads in full and passes on where they matter to a part. */
export function decisionsText(doc: Document) {
  return doc.records
    .filter((r) => r.kind === "decision" && r.status !== "superseded" && !r.data.modelPolicy)
    .map((r) => {
      const alternatives = r.data.alternatives?.length ? ` Alternatives considered: ${r.data.alternatives.join("; ")}.` : "";
      return `- ${r.title} (${r.id}): ${r.data.choice ?? ""}${r.data.context ? ` Context: ${r.data.context}` : ""}${alternatives}`;
    })
    .join("\n");
}

/**
 * The lead's system prompt: everything a subagent is told, and the plan's
 * decisions in full. What the Planning chat settled is in the plan and in
 * the owner's answers beside the planner's questions: a build starts only
 * when every question is settled.
 */
export function leadInstructions(input: {
  doc: Document;
  owner: OwnerMessage[];
  project: string;
  since?: string;
}) {
  const { doc, owner, project, since } = input;
  const decisions = decisionsText(doc);
  return [
    `You lead the build of "${project}", in the project folder: the current folder. The owner gave the go in the Planning chat; you build what the plan holds, with subagents where the work divides, and BaseSeer's acceptance check decides when it is done.`,
    readThePlan,
    ownerSection(owner, since),
    decisions ? `The plan's decisions in full; tell a subagent those that bear on its part:\n${decisions}` : "",
    architectureText(doc),
    work,
    `Besides its components, the project needs:\n${projectWork.map((item) => `- ${item}`).join("\n")}`,
    howToBuild,
    realRuntime,
    codeStandard,
    fewSteps,
    housekeeping,
    leadReport,
    `The plan's map:\n\n${mapSummary(doc)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The lead's first message: the whole plan, or what changed since the build
 * this one continues; for a repair, the validation's items it fixes, with
 * what changed, since a repair leaves the code as the plan now has it.
 */
export function leadTask(project: string, change?: { scope: ChangeScope; before?: Document }, repair?: string[]) {
  const changed = change && changeSection(change.scope, change.before);
  if (repair) {
    const items = repair.map((item) => item.trim()).join("\n\n");
    const alsoChanged = changed
      ? `\n\nThe plan has also changed since the last build, and this repair changes the code for that too. ${changed}`
      : "";
    return `Repair "${project}": BaseSeer's validation of its code against the plan, the owner's words and the code standard found the items below. Fix each wherever the program does the same thing; where an item restructures code, the program keeps doing exactly what it did. Where you find an item is not a defect, or that the plan rather than the code should change, leave it as it is and say why in your report.\n\n${items}${alsoChanged}`;
  }
  return changed
    ? `Build what the owner now asks of "${project}", which is already built. ${changed}`
    : `Build "${project}": every component in the plan.`;
}

const placeText = ({ component, items }: ReviewPlace) =>
  `- ${component ? `${component.title} (${component.id}), built on ${builtOn(component.route)}` : "no planned file"}: ${items}`;

/**
 * What the review found, every item of which the lead fixed before the check
 * passed: what the build was checked for beyond its own tests, which the
 * owner hears of from the planner alone.
 */
function reviewText(review?: BuildReview) {
  if (!review) return "";
  const what = "BaseSeer's review, which read the code against the owner's words and used the program as its owner will,";
  if (!found(review.report)) return `\n\n${what} found nothing.`;
  const items = reviewItems(review.report).map((item, n) => `- ${n + 1}. ${headline(item)}`);
  return `\n\n${what} reported ${items.length} item(s), each fixed by the lead before the check passed:\n${items.join("\n")}`;
}

/**
 * Where the review's items fell, by the planned files each names: the
 * planner chooses which model builds what, and this is what the build
 * shows of each choice.
 */
const reviewPlacesText = (places: ReviewPlace[]) =>
  places.length
    ? `\n\nWhere the review's items fell, by the planned files each names (an item naming several parts counts for each):\n${places.map(placeText).join("\n")}`
    : "";

/** What the planner is told once the build's check passes, about the project in the folder `root`. */
export const plannerReport = (report: string, root: string, review?: BuildReview, untested?: string) =>
  `BaseSeer: the build is complete: its acceptance check passed${untested ? `, running no test; the build recorded why: ${untested} Tell the owner so` : ""}. The lead's report:\n\n${report || "(The lead left no report.)"}${reviewText(review)}${reviewPlacesText(review?.places ?? [])}\n\nTell the owner, in plain words: what was built, that it is in ${root} and how they start using it, as its README says; how it was checked, what was found or decided, what was not built or not verified, and what is left for them to decide, among it each review item the lead fixed but thinks was wrong, in the lead's words. Update the plan where the report names files no component plans.`;

/** What the planner is told when the lead stops before the check passes. */
export const plannerLeadStopped = (message: string) =>
  `BaseSeer: the build's lead stopped before the acceptance check passed. Its last message:\n\n${message || "(The lead left no message.)"}\n\nAsk the owner what only they can decide, and answer the lead with plan_build {command:{action:"message",text:"..."}}; the owner can also stop the build in the Build view.`;

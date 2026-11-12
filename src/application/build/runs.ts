import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PlanError } from "../../domain/plan.ts";
import { buildPlan, componentModels, leadRoute, replacements } from "../../domain/build-plan.ts";
import type { WorkRoute } from "../../domain/work-automation.ts";
import type { Document } from "../../domain/records.ts";
import type { Records } from "../records.ts";
import type { Actor } from "../planning.ts";
import type { MapRefresher } from "../map-refresh.ts";
import {
  changeScope,
  digestOf,
  nextBuildSummary,
  type DeliveredBuild,
} from "./as-built.ts";
import {
  found,
  joinReports,
  leadInstructions,
  leadTask,
  placesToLook,
  plannerValidation,
  reviewInstructions,
  reviewTask,
  useInstructions,
  useTask,
  validationInstructions,
  validationTask,
} from "./briefs/index.ts";
import { inspectFindings } from "./code-findings.ts";
import { AcceptanceGate } from "./gate.ts";
import * as git from "./git.ts";
import {
  BUILD_CHAT_TITLES,
  BUILD_FORMAT,
  REVIEWERS,
  clip,
  now,
  type AcceptanceFailure,
  type BuildCommands,
  type BuildHost,
  type BuildRun,
  type LeadBrief,
  type Reviewer,
  type ValidationRun,
} from "./model.ts";
import { freePortBlock } from "./ports.ts";
import { withCode, withCommands } from "./readme.ts";
import { reviewItems, reviewPlaces } from "./review-places.ts";
import { BuildStore } from "./store.ts";
import { buildView } from "./view.ts";

// When the owner types /baseseer build in the Planning chat, a lead session
// builds the project with subagents that work in the project folder, while
// the planner waits for its report: every request of the planner carries the
// whole planning conversation, and the build needs only what that
// conversation settled.
// BaseSeer starts the build (it checks the plan, accepts the decisions it is
// built from and keeps the point it started from), starts the lead with what
// to build, and checks the work: the build is done once BaseSeer's acceptance
// check passes.

/** A completed build as the next one continues it. */
const deliveredBuild = (b: BuildRun): DeliveredBuild => ({
  id: b.id,
  startedAt: b.createdAt,
  endedAt: b.endedAt ?? b.createdAt,
  revision: b.revision,
  builtFrom: b.builtFrom,
});

const day = (at: string) => at.slice(0, 16).replace("T", " ");

const routeText = (m: WorkRoute) => `${m.model} (${m.thinking})`;

const repairText = (b: BuildRun) =>
  b.repair ? ` to repair the validation's item(s) ${b.repair.items.join(", ")}` : "";

function startNote(b: BuildRun, lead: WorkRoute, models: WorkRoute[], initializedRepository: boolean) {
  const change = b.change
    ? ` It continues the build of ${day(b.change.since.endedAt)}: ${b.change.changes.length} change(s) to the plan since.`
    : "";
  const repository = initializedRepository
    ? " Created a Git repository for the project folder."
    : "";
  return `Started on the owner's go${repairText(b)}: a lead on ${routeText(lead)} builds it, with subagents on ${models.map(routeText).join(", ")}, then BaseSeer's acceptance check.${change}${repository}`;
}

/** The receipt for recorded commands, and the log line for the owner. */
function recordedCommandsNote(before: BuildCommands | undefined, commands: BuildCommands) {
  const changed = Object.entries(commands).filter(([name, command]) => {
    const earlier = before?.[name as keyof BuildCommands];
    return earlier !== undefined && earlier !== command;
  });
  return changed.length
    ? `A subagent changed ${changed.map(([name, command]) => `${name} to "${command}"`).join(", ")}.`
    : `A subagent recorded the ${Object.keys(commands).join(", ")} command(s).`;
}

const NO_COMMANDS =
  "No project commands are recorded, so there is nothing to check yet: record the project's install, build, test and end-to-end commands with record_commands, or have the subagent that set up its tooling record them.";

const NO_TESTS =
  "No test command is recorded, so a passing check would show nothing about the project's tests: record the project's unit test or end-to-end command with record_commands, or, when no test can apply to this project, record why as untested, which the owner is told with the build.";

const STARTING = "A build of this project is starting. Wait for the planner's word that it started.";

// A reviewer that could not run or left no report is tried again on the next
// check; after this many such checks the build stops rather than complete
// without its review.
const REVIEW_ATTEMPTS = 2;

/** What the lead and the owner call each reviewer's work. */
const REVIEW_NAMES: Record<Reviewer, string> = { reviewer: "code review", tester: "use test" };

/** What the owner is told when their go starts a build. */
const startedText = (b: BuildRun, lead: WorkRoute, models: WorkRoute[], accepted: string[]) =>
  `${b.repair ? `Repair of the validation's item(s) ${b.repair.items.join(", ")}` : "Build"} started: a lead on ${routeText(lead)} builds it, with subagents on ${models.map(routeText).join(", ")}, then BaseSeer's acceptance check, and a code review and a use test of the program on this chat's model. ${
    accepted.length ? `Your go accepted these decisions:\n${accepted.map((decision) => `- ${decision}`).join("\n")}\n` : ""
  }You can watch the lead work in the chat "${BUILD_CHAT_TITLES.lead}" and, once the check passes, the code review in "${BUILD_CHAT_TITLES.reviewer}" and the use test in "${BUILD_CHAT_TITLES.tester}". Keep talking to BaseSeer here: when the build is done, the planner tells you here what was built and how to start using it.`;

const VALIDATING = `A validation of this project's code is running in the chat "${BUILD_CHAT_TITLES.validator}": the planner tells you here what it finds. Type the command again once it has.`;

const RUNNING = `A build of this project is running in the chat "${BUILD_CHAT_TITLES.lead}": the planner tells you here what was built and how to start using it when its check passes. Stop it in the Build view to start again.`;

const REVIEWED =
  "The acceptance check passed, and BaseSeer's review reported: its reviewer reads the owner's words against the build's changes, and its use test uses the program as its owner will, in a copy of the project; the items below are from the session that reported first, and the other's join at your next check, numbered on. The review stands for the owner, so fix every item of its report, wherever the program does the same thing, yourself or with a subagent, including the items you would have left alone; where you think an item was wrong, fix it all the same and say which and why in your report to the planner, which the owner reads. An item asking for what the program already does needs no change: confirm it in the program. Then check again, naming the items you fixed: fixed:[<its number>, ...]. The next passing check completes the build once every item is fixed.";

/** The lead has not yet named every item of the review fixed. */
const unsettledText = (items: number[]) =>
  `The acceptance check passed, but review item(s) ${items.join(", ")} are not fixed yet. Fix them and check again naming them; the build completes once every item is fixed.`;

/** One review session's report, or why it has none. */
type ReviewResult = { reviewer: Reviewer; report?: string; failure?: string };

/** What the lead learns from one run of the check. */
export type CheckResult =
  | { passed: true; instruction: string }
  | { passed: false; failures: AcceptanceFailure[]; placesToLook?: string[]; instruction: string }
  | { passed: false; review: string; placesToLook?: string[]; instruction: string }
  | { stopped: true };

/** Runs the project's builds: one at a time, each started by the owner in its Planning chat. */
export class BuildRuns {
  readonly records: Records;
  readonly directory: string;
  refresher?: MapRefresher;
  host?: BuildHost;
  private readonly store: BuildStore;
  private readonly gate: AcceptanceGate;

  constructor(records: Records, directory: string, refresher?: MapRefresher) {
    this.records = records;
    this.directory = directory;
    this.refresher = refresher;
    this.store = new BuildStore(records, (b) => void this.host?.ended?.(b));
    this.gate = new AcceptanceGate({
      store: this.store,
      directory,
      host: () => this.host,
    });
  }

  onChange(listener: (plan: string) => void) {
    return this.store.onChange(listener);
  }

  get(id: string): BuildRun {
    return this.store.get(id);
  }

  latest(plan: string): BuildRun | undefined {
    return this.store.latest(plan);
  }

  /** The project's build that is running, if any. */
  running(plan: string): BuildRun | undefined {
    return this.store.running(plan);
  }

  public(b: BuildRun) {
    return buildView(b, this.records.store.usage.usage(b.plan));
  }

  overview(plan: string) {
    const doc = this.records.doc(plan);
    const latest = this.latest(plan);
    const delivered = this.store.delivered(plan);
    return {
      revision: this.records.store.read(plan).revision,
      plan: buildPlan(doc),
      // What the next build changes once the project has been built.
      change: delivered ? nextBuildSummary(changeScope(doc, deliveredBuild(delivered))) : null,
      build: latest ? this.public(latest) : null,
    };
  }

  private planner(actor: Actor) {
    if (actor.role !== "planner")
      throw new PlanError("DENIED", "Only the planner of a Planning chat starts and steers a build");
  }

  /** The projects whose code a validation is reading, which no build changes meanwhile. */
  private readonly validating = new Set<string>();
  /** The plans whose build is between the owner's go and its first save. */
  private readonly starting = new Set<string>();

  /**
   * The owner's go, typed in the Planning chat `chat`: /baseseer build, or
   * /baseseer repair with the numbers of the latest validation's items it
   * fixes (every item when it names none). Starts the build and hands it to
   * the host, which starts the build's lead. Returns what the owner is told.
   * Only the owner starts a build, so nothing said in the chat is taken for
   * a go.
   */
  async start(actor: Actor, root: string, chat: string, repair?: number[]) {
    this.planner(actor);
    const plan = actor.plan;
    const running = this.store.running(plan);
    if (running) {
      if (running.chat !== chat)
        throw new PlanError(
          "BUSY",
          "Another Planning chat is building this project. The owner can stop that build in the Build view.",
        );
      return { build: this.public(running), instruction: RUNNING };
    }
    if (this.validating.has(plan)) throw new PlanError("BUSY", VALIDATING);
    if (this.starting.has(plan)) throw new PlanError("BUSY", STARTING);
    // The project is reserved until the build is saved, so two gos at once start one build.
    this.starting.add(plan);
    try {
      return await this.begin(actor, root, chat, repair);
    } finally {
      this.starting.delete(plan);
    }
  }

  private async begin(actor: Actor, root: string, chat: string, repair?: number[]) {
    const host = this.host;
    if (!host) throw new PlanError("UNAVAILABLE", "Builds are unavailable in this host");
    const plan = actor.plan;
    const doc = this.records.doc(plan);
    const ready = buildPlan(doc);
    if (!ready.ready)
      throw new PlanError("INCOMPLETE", `The build cannot start yet: ${ready.problems.join(" ")}`);
    const delivered = this.store.delivered(plan);
    const change = delivered ? changeScope(doc, deliveredBuild(delivered)) : undefined;
    const fixes = repair && this.repairItems(plan, repair);
    if (!fixes && change && !change.changes.length)
      throw new PlanError(
        "STALE",
        `Nothing in the plan has changed since the build of ${day(change.since.endedAt)}. Change the plan first, or type /baseseer validate to check the code against it.`,
      );
    const lead = leadRoute(doc)!;
    const models = componentModels(doc);
    for (const route of [lead, ...models]) await host.check(actor, route.model, route.thinking);
    const ports = await freePortBlock();
    await this.checkMachine(ports);
    const { revision, accepted } = this.acceptDecisions(actor, doc);
    const real = fs.realpathSync(root);
    const repo = git.ensureRepository(real);
    const id = randomUUID();
    const startHead = git.head(real);
    const base = git.snapshot(real, startHead, "BaseSeer build: starting point");
    git.protect(real, `builds/${id}/base`, base);
    const b: BuildRun = {
      format: BUILD_FORMAT,
      id,
      plan,
      workspace: actor.workspace,
      root: real,
      project: this.records.store.read(plan).title,
      revision,
      createdAt: now(),
      status: "running",
      reason: "Building",
      base,
      ...(repo.initialized ? { initializedRepository: true } : {}),
      // The project's lasting commands carry over to a build of it.
      ...(delivered?.commands ? { commands: delivered.commands } : {}),
      builtFrom: digestOf(doc),
      ...(change ? { change } : {}),
      ...(fixes ? { repair: { validation: fixes.validation, items: fixes.numbers } } : {}),
      ports,
      chat,
      lead: `session-${randomUUID()}`,
      reviewer: `session-${randomUUID()}`,
      tester: `session-${randomUUID()}`,
      process: this.store.process,
      machine: host.machineTools?.() ?? {},
      checks: [],
      startHead: startHead ?? null,
      log: [],
    };
    this.store.note(b, startNote(b, lead, models, repo.initialized));
    this.store.save(b);
    host.started?.(actor, b, this.leadBrief(b, lead, models, fixes?.items));
    return { build: this.public(b), instruction: startedText(b, lead, models, accepted) };
  }

  /** The latest validation's items a repair fixes: those the owner numbered, or every one. */
  private repairItems(plan: string, numbers: number[]) {
    const validation = this.records.store.validations.latest(plan);
    if (!validation || !found(validation.report))
      throw new PlanError(
        "STALE",
        "There is nothing to repair: /baseseer validate reads the code against the plan, and /baseseer repair then fixes what it found.",
      );
    const items = reviewItems(validation.report);
    const wanted = numbers.length ? [...new Set(numbers)] : items.map((_, n) => n + 1);
    if (wanted.some((n) => !Number.isInteger(n) || n < 1 || n > items.length))
      throw new PlanError("INVALID", `The validation's items are numbered 1 to ${items.length}.`);
    return { validation: validation.id, numbers: wanted, items: wanted.map((n) => items[n - 1]) };
  }

  /** What the lead builds (the whole plan, what changed since the build this one continues, or a repair's items) and how. */
  private leadBrief(b: BuildRun, route: WorkRoute, models: WorkRoute[], repair?: string[]): LeadBrief {
    const doc = this.records.doc(b.plan);
    const before = b.change
      ? this.records.store.recordsHistory.planAt(b.plan, b.change.since.revision)
      : undefined;
    const owner = this.records.store.ownerMessages.read(b.plan);
    return {
      route,
      models,
      instructions: leadInstructions({ doc, owner, project: b.project, since: b.change?.since.startedAt }),
      task: leadTask(b.project, b.change ? { scope: b.change, ...(before ? { before } : {}) } : undefined, repair),
    };
  }

  /**
   * The owner's /baseseer validate, typed in the Planning chat `chat`: a
   * session that changes nothing reads the project's code against the plan,
   * the owner's words and the code standard, with what BaseSeer's source
   * analysis finds as places to look. Its report is kept for /baseseer
   * repair and goes to the planner, which tells the owner. Returns what the
   * owner is told now.
   */
  validate(actor: Actor, root: string, chat: string) {
    this.planner(actor);
    if (!this.host?.validate || !this.host.tell)
      throw new PlanError("UNAVAILABLE", "Validation is unavailable in this host");
    const plan = actor.plan;
    if (this.store.running(plan))
      throw new PlanError("BUSY", "A build of this project is running: validate its code once the build is done.");
    if (this.validating.has(plan)) return VALIDATING;
    const v: ValidationRun = {
      id: randomUUID(),
      plan,
      workspace: actor.workspace,
      root: fs.realpathSync(root),
      chat,
      session: `session-${randomUUID()}`,
    };
    this.validating.add(plan);
    void this.validation(v).finally(() => this.validating.delete(plan));
    return `Validation started: a session reads the project's code against the plan, your words and BaseSeer's code standard, and changes nothing. You can watch it in the chat "${BUILD_CHAT_TITLES.validator}". The planner tells you here what it finds, and /baseseer repair then fixes it.`;
  }

  private async validation(v: ValidationRun) {
    const doc = this.records.doc(v.plan);
    let message: string;
    try {
      const brief = {
        instructions: validationInstructions({
          doc,
          owner: this.records.store.ownerMessages.read(v.plan),
          project: this.records.store.read(v.plan).title,
        }),
        task: validationTask(await inspectFindings(v.root, doc)),
      };
      const report = (await this.host!.validate!(v, brief)).trim();
      if (!report) throw new Error("its session ended without a report");
      this.records.store.validations.save({ id: v.id, plan: v.plan, at: now(), report });
      message = plannerValidation(report);
    } catch (error) {
      message = `BaseSeer: the validation the owner asked for could not finish: ${(error as Error).message}. Tell the owner they can type /baseseer validate again.`;
    }
    await this.host!.tell!(v.chat, message).catch(() => undefined);
  }

  /** The machine must be able to run the project's commands before any model is paid. */
  private async checkMachine(firstPort: number) {
    const problems = (await this.host!.checkEnvironment?.(this.directory, firstPort)) ?? [];
    if (problems.length)
      throw new PlanError("UNAVAILABLE", `This machine is not ready to build: ${problems.join(" ")}`);
  }

  /**
   * The owner's go accepts the decisions the build is built from, each
   * replacement in place of the decision it replaces, so only the owner
   * changes them later. Decisions that set the model policy or the lead's
   * model stay the planner's to adjust, as the components' models do. Returns
   * the plan's revision after, and the titles of the decisions accepted.
   */
  private acceptDecisions(actor: Actor, doc: Document) {
    const revision = this.records.store.read(actor.plan).revision;
    const drafts = doc.records.filter(
      (r) => r.kind === "decision" && r.status === "draft" && !r.data.modelPolicy && !r.data.lead,
    );
    if (!drafts.length) return { revision, accepted: [] };
    const replaced = new Set(replacements(doc).map((r) => r.replaces.id));
    const result = this.records.execute({ ...actor, id: "owner", role: "owner" }, {
      op: "batch",
      expected: revision,
      key: `accept-decisions-${randomUUID()}`,
      reason: "The owner's go: the build accepts the decisions it is built from",
      records: [
        ...drafts.map((r) => ({ ...r, status: "accepted" })),
        ...doc.records.filter((r) => replaced.has(r.id)).map((r) => ({ ...r, status: "superseded" })),
      ],
    });
    // The owner accepts what they can read: each decision's choice, not only its title.
    return { revision: result.revision, accepted: drafts.map((r) => `${r.title}: ${r.data.choice}`) };
  }

  private building(plan: string) {
    const b = this.store.running(plan);
    if (!b) throw new PlanError("STALE", "No build is running for this project.");
    return b;
  }

  /** The commands the project's running build has recorded, which its subagents run. */
  commands(plan: string): BuildCommands | undefined {
    return this.store.running(plan)?.commands;
  }

  /** Records project commands as a subagent of the running build sets each one up, and why no test command applies while none is recorded. */
  recordCommands(plan: string, commands: BuildCommands, untested?: string) {
    this.store.updateBuild(this.building(plan).id, (b) => {
      if (Object.keys(commands).length) this.store.note(b, recordedCommandsNote(b.commands, commands));
      b.commands = { ...b.commands, ...commands };
      // Once a test command is recorded the check runs it, and a reason none applies would tell the owner no test ran.
      if (b.commands.test || b.commands.e2e) delete b.untested;
      else if (untested) {
        b.untested = clip(untested, 300);
        this.store.note(b, `No test command applies, a subagent says: ${b.untested}`);
      }
    });
    return `Recorded ${Object.entries(commands)
      .map(([name, command]) => `${name}: ${command}`)
      .join("; ")}. Run the commands with project_command.`;
  }

  /**
   * The lead's check of its build: BaseSeer's acceptance check of the
   * project folder's files as they are now, and once it passes, the defect
   * review. A passing check completes the build once both reviewers have
   * reported and every item of the review is fixed.
   */
  async check(plan: string, fixed: number[] = []): Promise<CheckResult> {
    const { id } = this.building(plan);
    return this.store.inTurn(id, async () => {
      if (!this.host?.runAcceptanceCheck)
        throw new PlanError("UNAVAILABLE", "This host cannot run the project's commands");
      if (fixed.length) this.settle(id, fixed);
      // The check is of the project as the subagents leave it, and a passing one ends the build.
      await this.host.subagentsDone?.(this.store.get(id));
      const b = this.store.get(id);
      if (b.status !== "running") return { stopped: true };
      if (!b.commands)
        return { passed: false, failures: [{ check: "commands", summary: NO_COMMANDS }], instruction: NO_COMMANDS };
      // A check that runs no test shows nothing about the tests.
      if (!b.commands.test && !b.commands.e2e && !b.untested)
        return { passed: false, failures: [{ check: "commands", summary: NO_TESTS }], instruction: NO_TESTS };
      const doc = this.records.doc(b.plan);
      this.writeReadme(b, doc);
      const checked = await this.gate.run(id, doc);
      if (!checked) return { stopped: true };
      // Places to look go to the lead whenever it has work to do, a failure or the review's items.
      const places = checked.findings ? placesToLook(checked.findings) : [];
      if (!checked.run.failures.length) {
        const reviewed = await this.review(id, checked.run.of, doc, places);
        if (reviewed) return reviewed;
        const open = this.unsettled(this.store.get(id));
        if (open.length)
          return {
            passed: false,
            review: this.store.get(id).review!.report,
            ...(places.length ? { placesToLook: places } : {}),
            instruction: unsettledText(open),
          };
        this.complete(id, checked.run.of, doc);
        return {
          passed: true,
          instruction: "The acceptance check passed and the build is complete: end your turn now with your report for the planner.",
        };
      }
      const outside = checked.run.failures.some((f) => f.outside);
      return {
        passed: false,
        failures: checked.run.failures,
        ...(places.length ? { placesToLook: places } : {}),
        instruction: outside
          ? "The check could not run on this machine. End your turn with what it needs, for the planner to tell the owner; check again once it is fixed."
          : "Send each failure, with its evidence, to the subagent that built that part or to a new one, or fix it yourself, then check again. Never have a check or test weakened, skipped or deleted to make it pass; a test changes only when it checks the wrong thing.",
      };
    });
  }

  /** The review sessions at work, by build and reviewer: a report the lead has not seen yet is taken at the next check. */
  private readonly reviewing = new Map<string, Promise<ReviewResult>>();

  /**
   * The defect review, once the build's check first passes: the reviewers
   * that have not reported yet, started together. The first report's items
   * go to the lead as soon as it lands, so the lead fixes while the slower
   * session still works; the other's join at the check after, numbered on.
   * Returns the items added, with the check's places to look, or a reviewer
   * that could not run, for the lead to act on; nothing when the build is to
   * complete.
   */
  private async review(id: string, of: string, doc: Document, places: string[]): Promise<CheckResult | undefined> {
    const b = this.store.get(id);
    const owed = REVIEWERS.filter((reviewer) => !b.review?.from.includes(reviewer));
    if (!this.host?.review || !owed.length) return undefined;
    const settled = new Map<Reviewer, ReviewResult>();
    const pending = owed.map((reviewer) => {
      const key = `${id}:${reviewer}`;
      const running = this.reviewing.get(key) ?? this.reviewBy(b, reviewer, of, doc);
      this.reviewing.set(key, running);
      return running.then((result) => settled.set(reviewer, result));
    });
    await Promise.race(pending);
    // A report that lands in the same moment as the first joins it now rather than at the next check.
    await Promise.all(pending.map((p) => Promise.race([p, new Promise((r) => setTimeout(r, 0))])));
    // A clean first report gives the lead nothing to act on and cannot stand in for the other report.
    if (![...settled.values()].some((result) => result.failure || (result.report && found(result.report))))
      await Promise.all(pending);
    // A report taken here is the lead's; one still to come stays at work for the next check.
    for (const reviewer of settled.keys()) this.reviewing.delete(`${id}:${reviewer}`);
    const results = [...settled.values()];
    const after = this.store.get(id);
    if (after.status !== "running") return { stopped: true };
    const reports = results.flatMap((r) => (r.report ? [{ reviewer: r.reviewer, report: r.report }] : []));
    const joined = joinReports(after.review?.report ?? "", reports);
    if (reports.length)
      after.review = {
        ...after.review,
        at: now(),
        of,
        report: joined.report,
        from: [...(after.review?.from ?? []), ...reports.map((r) => r.reviewer)],
        places: found(joined.report) ? reviewPlaces(joined.report, doc) : [],
      };
    for (const { reviewer, report } of reports)
      this.store.note(after, found(report) ? `The ${REVIEW_NAMES[reviewer]} reported: ${clip(report, 600)}` : `The ${REVIEW_NAMES[reviewer]} found nothing.`);
    // A reviewer that could not run or left no report is not a clean one: the
    // next check tries it again, and a build without its report stops rather than complete.
    const why = results.flatMap((r) => (r.failure ? [r.failure] : [])).join(" ");
    if (why) {
      after.reviewFailures = (after.reviewFailures ?? 0) + 1;
      if (after.reviewFailures >= REVIEW_ATTEMPTS) {
        this.halt(after, `${why} The build cannot complete without its code review and use test.`);
        void this.host.ended?.(after);
        return { stopped: true };
      }
      this.store.note(after, `${why} The next check tries it again.`);
    }
    this.store.save(after);
    const again = why
      ? `${why} Check again once your subagents are done: BaseSeer tries it again, and the build completes only once it has every report.`
      : "";
    if (joined.added)
      return {
        passed: false,
        review: joined.added,
        ...(places.length ? { placesToLook: places } : {}),
        instruction: [REVIEWED, again].filter(Boolean).join(" "),
      };
    return why ? { passed: false, failures: [{ check: "review", summary: why }], instruction: again } : undefined;
  }

  /** One reviewer's report, or why it has none. The tester works in a copy of the project as the check passed it. */
  private async reviewBy(b: BuildRun, reviewer: Reviewer, of: string, doc: Document): Promise<ReviewResult> {
    const owner = this.records.store.ownerMessages.read(b.plan);
    const name = REVIEW_NAMES[reviewer];
    try {
      const folder = reviewer === "reviewer" ? b.root : this.useCopy(b, of);
      const brief =
        reviewer === "reviewer"
          ? { folder, instructions: reviewInstructions(owner, b.project, b.commands ?? {}), task: reviewTask(b.base, of) }
          : { folder, instructions: useInstructions(owner, b.project, doc, folder), task: useTask };
      const report = (await this.host!.review!(b, reviewer, brief)).trim();
      return report ? { reviewer, report } : { reviewer, failure: `The ${name} left no report.` };
    } catch (error) {
      return { reviewer, failure: `The ${name} could not run: ${(error as Error).message}` };
    }
  }

  /**
   * The tester's copy of the project, beside the check's own copy: the program
   * it starts keeps its data there, and the project folder stays as the build
   * left it. Each use test starts from a fresh copy, as an owner starts from
   * the delivered project; the copy before goes when the next is made, or
   * stays where a program the tester left running still holds its files.
   */
  private useCopy(b: BuildRun, of: string) {
    const prefix = `${b.plan.slice(0, 8)}-use-`;
    for (const earlier of fs.readdirSync(this.directory).filter((name) => name.startsWith(prefix)))
      try {
        fs.rmSync(path.join(this.directory, earlier), { recursive: true, force: true });
      } catch {
        /* Held open; the next use test tries again. */
      }
    const folder = path.join(this.directory, prefix + Date.now().toString(36));
    git.checkout(b.root, folder, of);
    return folder;
  }

  /** Keeps the review's items the lead names fixed, by their numbers. */
  private settle(id: string, fixed: number[]) {
    this.store.updateBuild(id, (b) => {
      const report = b.review?.report ?? "";
      if (!found(report)) throw new PlanError("INVALID", "Only a review's items can be fixed, and this build's review has reported none.");
      const count = reviewItems(report).length;
      for (const item of fixed)
        if (!Number.isInteger(item) || item < 1 || item > count)
          throw new PlanError("INVALID", `The review's items are numbered 1 to ${count}.`);
      b.review!.fixed = [...new Set([...(b.review!.fixed ?? []), ...fixed])].sort((a, c) => a - c);
      this.store.note(b, `The lead fixed review item(s) ${fixed.join(", ")}.`);
    });
  }

  /** The review's items the lead has not named fixed. */
  private unsettled(b: BuildRun) {
    const report = b.review?.report ?? "";
    if (!found(report)) return [];
    const done = new Set(b.review!.fixed ?? []);
    return reviewItems(report).map((_, i) => i + 1).filter((n) => !done.has(n));
  }

  /** Keeps the lead's report of a completed build, for the Build view. */
  reported(id: string, report: string) {
    this.store.updateBuild(id, (b) => {
      b.report = report;
    });
  }

  /** The planner passes the lead what the owner tells it for the running build. */
  async message(actor: Actor, text: string) {
    this.planner(actor);
    const b = this.building(actor.plan);
    if (!this.host?.tellLead) throw new PlanError("UNAVAILABLE", "This host cannot reach the build's lead");
    await this.host.tellLead(b, text);
    return "BaseSeer put your message in the lead's conversation. Its report still comes to you when the build is done.";
  }

  /** BaseSeer writes the README's Commands section from the recorded commands, and its Code section from the plan. */
  private writeReadme(b: BuildRun, doc: Document) {
    const file = path.join(b.root, "README.md");
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    const next = withCode(withCommands(current, b.project, b.commands!), b.project, doc);
    if (next === current) return;
    fs.writeFileSync(file, next);
    this.store.updateBuild(b.id, (run) => this.store.note(run, "Wrote the README's Commands and Code sections."));
  }

  /**
   * The acceptance check passed: the build is done, and its work is kept to
   * commit. It is built from the plan it was checked against, the planner's
   * own updates while building included.
   */
  private complete(id: string, result: string, doc: Document) {
    const b = this.get(id);
    b.builtFrom = digestOf(doc);
    try {
      git.release(b.root, `builds/${b.id}`);
      git.protect(b.root, `builds/${b.id}/result`, result);
    } catch {
      /* Refs are harmless; a later build can release them. */
    }
    b.status = "completed";
    b.endedAt = now();
    b.result = result;
    b.reason = b.untested
      ? `Done. The acceptance check passed; no test ran: ${b.untested}`
      : "Done. The acceptance check passed.";
    this.store.note(b, "Build complete.");
    this.store.save(b);
    this.host?.completed?.(b);
    void this.refresher?.request(b.plan, b.root, 0);
  }

  private owned(actor: Actor, id: string) {
    this.records.owner(actor);
    const b = this.get(id);
    if (b.plan !== actor.plan)
      throw new PlanError("DENIED", "This build belongs to another project");
    return b;
  }

  /**
   * The lead stopped before its check passed, with what it needs in its last
   * message, or, given none, started working again: the Build view says which.
   */
  leadStopped(id: string, message: string | undefined) {
    const reason =
      message === undefined
        ? "Building"
        : `The lead stopped before the check passed${message ? `: ${clip(message.split("\n")[0], 300)}` : "."}`;
    const b = this.store.get(id);
    if (b.status !== "running" || b.reason === reason) return;
    b.reason = reason;
    if (message !== undefined) this.store.note(b, reason);
    this.store.save(b);
  }

  private halt(b: BuildRun, reason: string) {
    for (const reviewer of REVIEWERS) this.reviewing.delete(`${b.id}:${reviewer}`);
    b.status = "stopped";
    b.endedAt = now();
    b.reason = reason;
    this.store.note(b, reason);
    this.store.save(b);
  }

  /** The owner stops the build: its check, its lead and their subagents stop, and their work stays in the project folder. */
  async stop(actor: Actor, id: string) {
    const b = this.owned(actor, id);
    if (b.status !== "running") return this.public(b);
    this.halt(b, "Stopped by the owner. The work so far stays in the project folder.");
    this.gate.stop(id);
    await this.host?.ended?.(b);
    return this.public(this.get(id));
  }

  /** The lead could not start, so the build ends before any of it is built. */
  failed(id: string, reason: string) {
    const b = this.get(id);
    if (b.status !== "running") return;
    this.halt(b, reason);
    void this.host?.ended?.(b);
  }

  /**
   * The owner commits a finished build: one commit with the build's files on
   * the current branch when it has not moved, otherwise on a new branch.
   */
  commit(actor: Actor, id: string) {
    const b = this.owned(actor, id);
    if (b.status !== "completed" || !b.result)
      throw new PlanError("STALE", "Only a finished build can be committed");
    if (b.committed)
      throw new PlanError(
        "STALE",
        `This build is already committed${b.committed.branch ? ` on ${b.committed.branch}` : ""}.`,
      );
    const result = git.commitBuild(b.root, {
      start: b.startHead ?? undefined,
      result: b.result,
      message: `BaseSeer build: ${b.project}`,
      branch: `baseseer/build-${b.createdAt.slice(0, 10)}-${b.id.slice(0, 8)}`,
    });
    b.committed = { ...result, at: now() };
    this.store.note(
      b,
      result.moved
        ? `Committed ${result.files} file(s) on a new branch ${result.branch}: your branch moved since the build started. Merge it when you are ready.`
        : `Committed ${result.files} file(s)${result.branch ? ` on ${result.branch}` : ""}.`,
    );
    try {
      git.release(b.root, `builds/${b.id}/result`);
    } catch {
      /* The branch now holds the commit. */
    }
    this.store.save(b);
    return this.public(b);
  }
}

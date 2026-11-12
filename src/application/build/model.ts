import type { WorkRoute } from "../../domain/work-automation.ts";
import type { Actor } from "../planning.ts";

// What a build is, as saved, and the interface to the host that checks it.

/** The project's own commands, as the build's subagents recorded them. */
export type BuildCommands = {
  install?: string;
  build?: string;
  test?: string;
  /** Reports code the project's linter rejects. */
  lint?: string;
  /** End-to-end tests: the project used the way its user uses it. */
  e2e?: string;
};

/** The plan as a subagent reads it through its map tool. */
export interface PlanMap {
  /** The plan's records, or with ids those records exactly, with the links that touch them. */
  records(ids?: string[]): unknown;
  /** Each planned component against the files in the project folder: built, partial or missing. */
  coverage(): Promise<unknown>;
}

/** One problem BaseSeer's acceptance check found in the project. */
export type AcceptanceFailure = {
  /**
   * The check that failed: a recorded command's name, "architecture" for files
   * that import each other and imports the plan does not allow, or "machine"
   * for the tools the machine shares.
   */
  check: string;
  /** One line for the owner and for whoever fixes it. */
  summary: string;
  /** The end of the command's output. */
  detail?: string;
  /** The command's whole output, which BaseSeer saves in the project folder rather than in the build. */
  output?: string;
  /** Where in the project folder the whole output is. */
  log?: string;
  /** The project files its output points at, such as a failing test or a file with a type error. */
  files?: string[];
  /** The cause is outside the project (the machine or the network), so no fix to the code helps. */
  outside?: boolean;
  /** The command failed once and passed in another run, so the build's later checks run it three times. */
  unreliable?: boolean;
};

/** One run of the acceptance check over the build's work. */
export type AcceptanceRun = {
  at: string;
  endedAt: string;
  /** The work the check ran on. */
  of: string;
  failures: AcceptanceFailure[];
};

/** A copy of the project, and what BaseSeer needs to run its recorded commands there. */
export type ProjectCopy = {
  folder: string;
  commands: BuildCommands;
  /** The port the check's servers use, such as the end-to-end tests' server. */
  port: number;
  /** The project's files in the copy, so a failure can name those its output points at. */
  files?: string[];
  /** Stops the check's commands when the owner stops the build. */
  signal?: AbortSignal;
  /** The commands an earlier check of the build found unreliable: each has to pass three runs in a row. */
  unreliable?: string[];
  /** Told when the recorded install has passed, before anything else runs. */
  installed?(): void;
};

/** How many of a review's items name a file of one component, built on its planned model; the component is absent for items naming no planned file. */
export type ReviewPlace = { component?: { id: string; title: string; route: WorkRoute }; items: number };

/**
 * The review's two sessions, each its own judge of the build: the reviewer
 * reads the code against the owner's words, and the tester uses the program
 * as its owner would, since some defects show only in use.
 */
export const REVIEWERS = ["reviewer", "tester"] as const;
export type Reviewer = (typeof REVIEWERS)[number];

/**
 * The defect review: the snapshot it last read, what its reviewers reported
 * as one numbered list, which reviewers that list holds, where its items fell
 * in the plan and the items the lead has fixed. The review stands for the
 * owner, so a build completes only once every reviewer has reported and every
 * item is fixed.
 */
export type BuildReview = {
  at: string;
  of: string;
  report: string;
  from: Reviewer[];
  places: ReviewPlace[];
  fixed?: number[];
};

/** Folders the machine's tools install into for every project, each with the names it holds. */
export type MachineTools = Record<string, string[]>;

/** What the build's lead starts from: its model, its subagents' models and its brief. */
export type LeadBrief = {
  route: WorkRoute;
  /** The models the plan builds its components on, the only ones the lead starts subagents on. */
  models: WorkRoute[];
  /** Its instructions. */
  instructions: string;
  /** Its first message: what to build. */
  task: string;
};

/**
 * The titles of the chats BaseSeer starts among the project's chats, a
 * build's lead and reviewers and a validation: the owner can watch them work
 * there, and talks to BaseSeer only in the Planning chat, whose messages
 * every build reads.
 */
export const BUILD_CHAT_TITLES = {
  lead: "BaseSeer build (watch only)",
  reviewer: "BaseSeer review (watch only)",
  tester: "BaseSeer use test (watch only)",
  validator: "BaseSeer validation (watch only)",
} as const;

/** A validation of the project's code while its session reads it: where, and the Planning chat that gets its report. */
export type ValidationRun = { id: string; plan: string; workspace: string; root: string; chat: string; session: string };

/** What BaseSeer needs from its host to start and check a build. Implemented by the DSH integration. */
export interface BuildHost {
  /** Checks a planned model against the owner's model policy, as a session is started on it. */
  check(actor: Actor, model: string, thinking: string): Promise<void>;
  /**
   * Proves this machine can run the project's commands, without any model,
   * and returns what is wrong. Builds do not start on a machine that fails it.
   */
  checkEnvironment?(buildsRoot: string, firstPort: number): Promise<string[]>;
  /**
   * BaseSeer's own acceptance check of the project, without any model: its
   * recorded commands. Returns what failed; nothing means it passed.
   */
  runAcceptanceCheck?(input: ProjectCopy): Promise<AcceptanceFailure[]>;
  /** The folders every project on this machine shares, each with what it holds. */
  machineTools?(): MachineTools;
  /**
   * One round of one of the build's reviewers: the session, started with its
   * instructions on its first round and running its commands in `folder`,
   * gets the task and answers with its report.
   */
  review?(b: BuildRun, reviewer: Reviewer, brief: { folder: string; instructions: string; task: string }): Promise<string>;
  /**
   * A build started on the owner's go: the host summarizes the Planning chat
   * and starts the build's lead.
   */
  started?(actor: Actor, b: BuildRun, lead: LeadBrief): void;
  /**
   * A build ended before its check passed: its lead and the subagents it
   * started stop, and the lead's session loses the full access the build gave it.
   */
  ended?(b: Pick<BuildRun, "id" | "lead">): Promise<void>;
  /** Resolves once none of the lead's subagents is in the middle of a turn. */
  subagentsDone?(b: Pick<BuildRun, "id" | "lead" | Reviewer>): Promise<void>;
  /** A build passed its check: the planner gets the lead's report, and the lead loses its full access. */
  completed?(b: BuildRun): void;
  /** Puts the planner's message in the lead's conversation. */
  tellLead?(b: BuildRun, text: string): Promise<void>;
  /**
   * The owner's validation: a session that changes nothing reads the
   * project, given the instructions and the task, and answers with its report.
   */
  validate?(v: ValidationRun, brief: { instructions: string; task: string }): Promise<string>;
  /** Puts BaseSeer's own message in a chat, for its model to answer. */
  tell?(chat: string, text: string): Promise<void>;
}

// The plan as a build started from it, kept with the build so the next build
// can tell what changed since (as-built.ts works it out).

/** The plan as a build started from it: each record's kind, title and content hash, and each link. */
export type PlanDigest = {
  records: Record<string, { kind: string; title: string; hash: string }>;
  links: string[];
};

/** A plan record, or a link between two, that differs from the plan a build started from. */
export type RecordChange = {
  id: string;
  kind: string;
  title: string;
  change: "added" | "changed" | "removed";
};

/** What a build of a built project changes: what changed in the plan since the completed build it continues. */
export type ChangeScope = {
  /** The build it continues; the owner's messages after that build started are new to it. */
  since: { build: string; startedAt: string; endedAt: string; revision: number };
  changes: RecordChange[];
};

/**
 * The shape of the saved builds this version reads and writes. A build saved
 * in another shape stays in its file untouched, but is not shown or run.
 */
export const BUILD_FORMAT = 21;

export type BuildRun = {
  format: typeof BUILD_FORMAT;
  id: string;
  plan: string;
  workspace: string;
  root: string;
  project: string;
  revision: number;
  createdAt: string;
  endedAt?: string;
  status: "running" | "completed" | "stopped";
  reason: string;
  /** The commit the build started from. */
  base: string;
  /** The work the passing acceptance check ran on, which Commit build commits. */
  result?: string;
  commands?: BuildCommands;
  /** Why no test command applies to the project, when its subagents recorded none: the owner is told with the build. */
  untested?: string;
  /** The plan as this build started from it, and once it is complete as it was checked: the next build is measured against it. */
  builtFrom: PlanDigest;
  /** For a build of a project already built: what changed in the plan since. */
  change?: ChangeScope;
  /** For a repair: the validation it repairs, and the numbers of the items it fixes. */
  repair?: { validation: string; items: number[] };
  initializedRepository?: boolean;
  /** First of this build's ports: the acceptance check's, then one for the lead and each subagent. */
  ports: number;
  /** The Planning chat the owner gave the go in, which gets the lead's report. */
  chat: string;
  /** The session that leads the build. */
  lead: string;
  /** The session that reads the build's code against the owner's words once its check passes. */
  reviewer: string;
  /** The session that uses the program as its owner would once the build's check passes, in a copy of the project. */
  tester: string;
  /** The review, from the first of its reviewers to report. */
  review?: BuildReview;
  /** How many checks a reviewer could not run in or left no report for; the build stops rather than complete without both reports. */
  reviewFailures?: number;
  /** The lead's report once the build is complete, which the planner gets and the Build view shows. */
  report?: string;
  /** The BaseSeer process that runs it, gone with its lead when DSH restarts. */
  process: string;
  /** The machine's shared tool folders as the build found them, which it must leave so. */
  machine: MachineTools;
  /** Every run of BaseSeer's acceptance check over the build's work. */
  checks: AcceptanceRun[];
  /** The project's HEAD when the build started; null when it had no commits. */
  startHead?: string | null;
  committed?: {
    commit: string;
    branch?: string;
    moved: boolean;
    files: number;
    at: string;
  };
  log: { at: string; text: string }[];
};

export const now = () => new Date().toISOString();

export const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

import fs from "node:fs";
import path from "node:path";
import type { Document } from "../../domain/records.ts";
import { inspectFindings, type CodeFindings } from "./code-findings.ts";
import * as git from "./git.ts";
import {
  clip,
  now,
  type AcceptanceFailure,
  type AcceptanceRun,
  type BuildHost,
  type MachineTools,
} from "./model.ts";
import type { BuildStore } from "./store.ts";

// BaseSeer's acceptance check. A build is not done until the project passes
// its own recorded commands in a clean copy of the project folder. Every
// result is a fact from a real run, not a subagent's report.

/** Where in the project folder the check saves the whole output of what failed, beside its other test output. */
const OUTPUT_FOLDER = "test-results/acceptance";

/**
 * Saves a failed command's whole output in the project folder, where whoever
 * fixes it reads it. The evidence the check keeps is the output's end, and a
 * test runner's first error, often the cause, can come before it.
 */
function keepOutput(root: string, run: number, failure: AcceptanceFailure): AcceptanceFailure {
  const { output, ...kept } = failure;
  if (!output) return kept;
  const log = `${OUTPUT_FOLDER}/${run}-${failure.check}.log`;
  fs.mkdirSync(path.join(root, OUTPUT_FOLDER), { recursive: true });
  fs.writeFileSync(path.join(root, log), output);
  return { ...kept, log };
}

/**
 * Source files that import each other at run time fail the check like a
 * failing test: none of them can change or be tested alone.
 */
function cycleFailures(cycles: string[][]): AcceptanceFailure[] {
  if (!cycles.length) return [];
  return [
    {
      check: "architecture",
      summary: `${cycles.length} group(s) of source files import each other at run time; break each, for example by moving what they share into a module of its own.`,
      detail: cycles.map((cycle) => cycle.join(" <-> ")).join("\n"),
      files: [...new Set(cycles.flat())].sort(),
    },
  ];
}

const IMPORTS_SHOWN = 16;

/**
 * An import between components that the plan does not let use each other
 * fails the check: the plan's dependencies are the project's architecture,
 * and code that crosses them unnoticed leaves the plan describing a project
 * that does not exist. The plan can be what is wrong, so the failure names
 * both ways out, and either the code or the plan changes.
 */
function boundaryFailures(imports: CodeFindings["unplannedImports"]): AcceptanceFailure[] {
  if (!imports.length) return [];
  const more = imports.length - IMPORTS_SHOWN;
  return [
    {
      check: "architecture",
      summary: `${imports.length} import(s) cross between components the plan does not let use each other. For each, remove the coupling (move what both need into the shared code, or call through the planned part); where the code is right and the plan is wrong, end your turn asking the planner to allow that dependency, and check again once it has.`,
      detail: [
        ...imports.slice(0, IMPORTS_SHOWN).map((i) => `${i.path}${i.line ? `:${i.line}` : ""}: ${i.description}`),
        ...(more > 0 ? [`and ${more} more.`] : []),
      ].join("\n"),
      files: [...new Set(imports.map((i) => i.path))].sort(),
    },
  ];
}

/**
 * A project's dependencies belong in the project folder, where its recorded
 * install puts them. One installed into the tools the machine shares makes the
 * check pass where a fresh machine would fail, and changes the owner's tools.
 */
function machineFailures(before: MachineTools, after: MachineTools): AcceptanceFailure[] {
  const changes = Object.keys({ ...before, ...after }).flatMap((folder) => {
    const was = new Set(before[folder] ?? []);
    const now = new Set(after[folder] ?? []);
    const changed = [
      ...[...now].filter((name) => !was.has(name)).map((name) => `added ${name}`),
      ...[...was].filter((name) => !now.has(name)).map((name) => `removed ${name}`),
    ];
    return changed.length ? [`${folder}: ${changed.join(", ")}`] : [];
  });
  if (!changes.length) return [];
  return [
    {
      check: "machine",
      summary:
        "This build changed what this machine shares with every project, outside the project folder. Install the project's dependencies and tools inside the project folder through its recorded install (for Python, a virtual environment the other commands run from), keep them off the user's PATH, and undo what the build changed on the machine.",
      detail: changes.join("\n"),
    },
  ];
}

const listed = (failures: AcceptanceFailure[]) =>
  failures.map((f) => f.summary).join(" ");

/** The build log's line for one run of the check. */
function acceptanceNote(run: AcceptanceRun, number: number) {
  if (!run.failures.length) return `Acceptance check ${number} passed.`;
  return `Acceptance check ${number} found ${run.failures.length} problem(s): ${clip(listed(run.failures), 600)}`;
}

/** One run of the check, with what BaseSeer's source analysis found as places to look; nothing if the build stopped meanwhile. */
export type Checked = { run: AcceptanceRun; findings?: CodeFindings } | undefined;

export class AcceptanceGate {
  private readonly store: BuildStore;
  private readonly directory: string;
  private readonly host: () => BuildHost | undefined;
  /** Each build's check while it runs, so stopping the build stops its commands. */
  private readonly running = new Map<string, AbortController>();
  /** For each copy, what the project's install left in it last time, kept for the next check. */
  private readonly installed = new Map<string, string[]>();

  constructor(options: {
    store: BuildStore;
    /** Where the check keeps its copy of each project. */
    directory: string;
    host(): BuildHost | undefined;
  }) {
    this.store = options.store;
    this.directory = options.directory;
    this.host = options.host;
  }

  /** Stops the commands of the build's check, if one is running. */
  stop(id: string) {
    this.running.get(id)?.abort();
  }

  /**
   * One run of the check in a clean copy of the project folder's files as
   * they are now. Each project keeps one copy at a short path, reset for
   * every check but for what its install left there, so what the install
   * fetches is fetched once rather than every time, its paths stay within
   * what Windows tools accept, and the firewall asks about its programs once.
   */
  async run(id: string, doc: Document): Promise<Checked> {
    const b = this.store.get(id);
    const number = b.checks.length + 1;
    // A build's checks number their output from 1, so an earlier build's output would pass for theirs.
    if (number === 1) fs.rmSync(path.join(b.root, OUTPUT_FOLDER), { recursive: true, force: true });
    const folder = path.join(this.directory, b.plan.slice(0, 8));
    const at = now();
    const of = git.snapshot(b.root, b.base, `BaseSeer: ${b.project}, acceptance check ${number}`);
    git.protect(b.root, `builds/${b.id}/check`, of);
    let failures: AcceptanceFailure[];
    let findings: CodeFindings | undefined;
    const stopping = new AbortController();
    this.running.set(id, stopping);
    try {
      git.checkout(b.root, folder, of, this.installed.get(folder));
      failures = await this.host()!.runAcceptanceCheck!({
        folder,
        commands: b.commands!,
        port: b.ports,
        files: git.files(b.root, of),
        signal: stopping.signal,
        unreliable: [...new Set(b.checks.flatMap((c) => c.failures.filter((f) => f.unreliable).map((f) => f.check)))],
        installed: () => void this.installed.set(folder, git.ignored(folder)),
      });
      findings = await inspectFindings(folder, doc);
      failures.push(...cycleFailures(findings?.cycles ?? []));
      failures.push(...boundaryFailures(findings?.unplannedImports ?? []));
      failures.push(...machineFailures(b.machine, this.host()!.machineTools?.() ?? {}));
    } catch (e) {
      failures = [
        {
          check: "acceptance",
          summary: `The acceptance check could not run: ${(e as Error).message}.`,
          outside: true,
        },
      ];
    } finally {
      this.running.delete(id);
    }
    const after = this.store.get(id);
    if (after.status !== "running") return undefined;
    const run: AcceptanceRun = {
      at,
      endedAt: now(),
      of,
      failures: failures.map((f) => keepOutput(after.root, number, f)),
    };
    after.checks = [...after.checks, run];
    this.store.note(after, acceptanceNote(run, number));
    this.store.save(after);
    return { run, ...(findings ? { findings } : {}) };
  }
}

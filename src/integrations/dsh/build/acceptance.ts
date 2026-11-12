import type {
  AcceptanceFailure,
  ProjectCopy,
} from "../../../application/build/index.ts";
import { plainOutput, type RecordedCommand } from "./commands.ts";
import { toolFolders } from "./environment.ts";
import { filesNamedIn } from "./output-files.ts";
import { runRecorded, tail, type CommandResult } from "./recorded-run.ts";

// BaseSeer's acceptance check of the build's work: in a clean copy, it runs
// the project's own recorded commands the way continuous integration would.
// Every result is a fact from a real run, not a subagent's report, which can
// leave out a test that fails most runs.

/** The checks in the order they run, each named as the owner reads it. */
const COMMAND_CHECKS: { name: RecordedCommand; label: string }[] = [
  { name: "install", label: "Installing the dependencies" },
  { name: "build", label: "The build" },
  { name: "test", label: "The unit tests" },
  { name: "lint", label: "The lint check" },
  { name: "e2e", label: "The end-to-end tests" },
];

// An install that cannot reach the package registry is the machine's
// problem, not the project's.
const NETWORK_FAILURE =
  /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH|getaddrinfo/;

/** The output of a failed run, and the project files it points at, which tell whose work the failure is. */
function evidence(input: ProjectCopy, result: CommandResult) {
  const files = filesNamedIn(result.output, input.files ?? []);
  return {
    detail: tail(result.output),
    output: plainOutput(result.output),
    ...(files.length ? { files } : {}),
  };
}

function commandFailure(
  input: ProjectCopy,
  check: { name: RecordedCommand; label: string },
  result: CommandResult,
): AcceptanceFailure {
  const command = input.commands[check.name]!;
  const outside = check.name === "install" && NETWORK_FAILURE.test(result.output);
  if (outside)
    return {
      check: check.name,
      summary: `${check.label} could not reach the network (${command}).`,
      detail: tail(result.output),
      outside: true,
    };
  return {
    check: check.name,
    summary: `${check.label} failed (${command} exited with ${result.code}).`,
    ...evidence(input, result),
  };
}

// Tests that fail run again, to tell an unreliable test from a failing one,
// such as a test that depends on the order a store returns random keys in.
const RUN_AGAIN: RecordedCommand[] = ["test", "e2e"];

// One clean run cannot show that an unreliable test was fixed: the build's
// later checks run it this many times, and it has to pass each one.
const RUNS_ONCE_UNRELIABLE = 3;

function unreliable(
  input: ProjectCopy,
  check: { name: RecordedCommand; label: string },
  failed: CommandResult,
): AcceptanceFailure {
  const command = input.commands[check.name]!;
  return {
    check: check.name,
    summary: `${check.label} failed once and passed in another run, so a test is unreliable (${command}).`,
    ...evidence(input, failed),
    unreliable: true,
  };
}

/** Runs one recorded check, and a failing test run once more. */
async function runCheck(
  input: ProjectCopy,
  check: { name: RecordedCommand; label: string },
  tools: string[],
): Promise<AcceptanceFailure | undefined> {
  const runs = input.unreliable?.includes(check.name) ? RUNS_ONCE_UNRELIABLE : 1;
  for (let run = 1; run <= runs; run++) {
    const result = await runRecorded(input, check.name, tools);
    if (result.code === 0) continue;
    if (run > 1) return unreliable(input, check, result);
    if (!RUN_AGAIN.includes(check.name)) return commandFailure(input, check, result);
    const again = await runRecorded(input, check.name, tools);
    if (again.code !== 0) return commandFailure(input, check, again);
    return unreliable(input, check, result);
  }
  return undefined;
}

/**
 * Runs the recorded commands in order, skipping what needs a build when the
 * build failed. A failed install stops them, since nothing
 * after it can run.
 */
async function commandFailures(input: ProjectCopy, tools: string[]) {
  const failures: AcceptanceFailure[] = [];
  for (const check of COMMAND_CHECKS) {
    if (input.signal?.aborted) break;
    if (!input.commands[check.name]) continue;
    // The end-to-end tests need a build that works.
    if (check.name === "e2e" && failures.some((f) => f.check === "build")) continue;
    const failure = await runCheck(input, check, tools);
    if (!failure) {
      if (check.name === "install") input.installed?.();
      continue;
    }
    failures.push(failure);
    if (check.name === "install") break;
  }
  return failures;
}

/** The acceptance check: each recorded command in order. */
export function runAcceptanceCheck(
  input: ProjectCopy,
  options: { toolFolders?: string[] } = {},
): Promise<AcceptanceFailure[]> {
  return commandFailures(input, options.toolFolders ?? toolFolders());
}

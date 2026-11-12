import { spawn } from "node:child_process";
import type { ProjectCopy } from "../../../application/build/index.ts";
import {
  plainOutput,
  projectCommandScript,
  type RecordedCommand,
} from "./commands.ts";
import { commandEnvironment, localPowerShell } from "./environment.ts";
import { stopProcessTree } from "./process-tree.ts";

// The project's recorded commands as BaseSeer runs them, for a subagent and
// for its own check: in PowerShell, the way continuous integration would.
// A hung command must return control so the builder can diagnose it.

const OUTPUT_TAIL = 4000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type CommandResult = { code: number; output: string };

/** The end of what a command printed, without the colour codes test runners write. */
export function tail(text: string, limit = OUTPUT_TAIL) {
  const plain = plainOutput(text);
  if (plain.length <= limit) return plain;
  return `…${plain.slice(-limit)}`;
}

/** Runs a script until completion, cancellation or its deadline. */
export function runPowerShell(
  script: string,
  folder: string,
  signal?: AbortSignal,
  settings: Record<string, string> = {},
  timeoutMs = COMMAND_TIMEOUT_MS,
) {
  return new Promise<CommandResult>((resolve) => {
    const shell = localPowerShell();
    if (!shell) {
      resolve({ code: 1, output: "PowerShell is not installed here." });
      return;
    }
    if (signal?.aborted) {
      resolve({ code: 1, output: "Stopped." });
      return;
    }
    const child = spawn(
      shell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { cwd: folder, env: { ...commandEnvironment(), ...settings }, windowsHide: true },
    );
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const stop = () => {
      output += "\nStopped.";
      stopProcessTree(child);
    };
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\n[timed out after ${timeoutMs}ms]`;
      stopProcessTree(child);
    }, timeoutMs);
    child.on("error", (error) => {
      output += `\n${error.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ code: timedOut ? 124 : code ?? 1, output });
    });
  });
}

/** Settings every command runs with: continuous integration and the copy's own port. */
export function settingsFor(input: ProjectCopy) {
  return { CI: "1", PORT: String(input.port) };
}

/** Runs one recorded command in the copy, once a command slot is free. */
export function runRecorded(
  input: ProjectCopy,
  name: RecordedCommand,
  tools: string[],
) {
  const { script } = projectCommandScript(
    input.commands,
    [{ name, args: [] }],
    input.folder,
    settingsFor(input),
    tools,
  );
  return runPowerShell(script, input.folder, input.signal);
}

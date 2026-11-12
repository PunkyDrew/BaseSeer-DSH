import path from "node:path";
import { PlanError } from "../../../domain/plan.ts";
import type { BuildCommands } from "../../../application/build/index.ts";

/**
 * Every command a build can record, all of which its subagents run through
 * project_command and BaseSeer's acceptance check runs in order. Each runs
 * to completion: how the project itself is run is the README's to say.
 */
export const RECORDED_COMMANDS = [
  "install",
  "build",
  "test",
  "lint",
  "e2e",
] as const;
export type RecordedCommand = (typeof RECORDED_COMMANDS)[number];

export const PROJECT_COMMAND_TOOL = "project_command";
export const RECORD_COMMANDS_TOOL = "record_commands";

export type CommandStep = { name: RecordedCommand; args: string[] };

const COLOUR_CODE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** What a command printed, without the colour codes test runners write for a terminal. */
export const plainOutput = (text: string) => text.replace(COLOUR_CODE, "");

// A recorded command must be a plain program call: the README gives it to the owner to
// type into a shell, where these would chain, redirect, quote, expand or comment. Every
// other character is the program's to read, such as the brackets of pip's extras.
const SHELL_SYNTAX = /[|&;<>()$`"'{}#]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_ARGS = 20;
// Each recorded command at most once, so a subagent can chain every one of them.
const MAX_STEPS = RECORDED_COMMANDS.length;
const MAX_SETTINGS = 10;

/** PowerShell single-quoted strings are literal; a quote inside is doubled. */
export const powershellQuote = (word: string) =>
  `'${word.replaceAll("'", "''")}'`;

function pointsOutside(arg: string, cwd: string) {
  const value =
    arg.startsWith("-") && arg.includes("=")
      ? arg.slice(arg.indexOf("=") + 1)
      : arg;
  const looksLikePath =
    path.isAbsolute(value) || /[\\/]/.test(value) || value === "..";
  if (!looksLikePath) return false;
  const relative = path.relative(cwd, path.resolve(cwd, value));
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/** The words of a recorded command, or an error naming why it cannot be run as one program call. */
export function recordedWords(recorded: string) {
  const words = recorded.trim().split(/\s+/);
  if (!words[0] || words.some((word) => SHELL_SYNTAX.test(word) || CONTROL.test(word)))
    throw new PlanError(
      "INVALID",
      `The command "${recorded}" is not a plain program call (no chaining, redirection, quoting or variables). Record a script in the project's own tooling instead, such as a package script.`,
    );
  return words;
}

/**
 * The PowerShell line that runs a recorded project command with extra
 * arguments, every word passed literally. Refuses a recorded command that is
 * not a plain program call and arguments that reach outside the folder.
 */
export function projectCommandLine(
  recorded: string,
  args: string[],
  cwd: string,
) {
  const words = recordedWords(recorded);
  if (args.length > MAX_ARGS)
    throw new PlanError("INVALID", `Pass at most ${MAX_ARGS} arguments`);
  for (const arg of args) {
    if (!arg || arg.length > 300 || CONTROL.test(arg))
      throw new PlanError("INVALID", "Each argument must be short plain text");
    if (pointsOutside(arg, cwd))
      throw new PlanError(
        "INVALID",
        `The argument ${arg} points outside this folder`,
      );
  }
  return `& ${[...words, ...args].map(powershellQuote).join(" ")}`;
}

/** PowerShell lines that set each environment setting for this run only; PATH stays BaseSeer's. */
export function environmentLines(settings: Record<string, string> = {}) {
  const entries = Object.entries(settings);
  if (entries.length > MAX_SETTINGS)
    throw new PlanError(
      "INVALID",
      `Pass at most ${MAX_SETTINGS} environment settings`,
    );
  return entries.map(([name, value]) => {
    if (!SETTING_NAME.test(name) || name.toUpperCase() === "PATH")
      throw new PlanError(
        "INVALID",
        `${name} cannot be set here; use a plain setting name other than PATH`,
      );
    if (typeof value !== "string" || value.length > 1000 || CONTROL.test(value))
      throw new PlanError(
        "INVALID",
        `The setting ${name} must be short plain text`,
      );
    return `$env:${name} = ${powershellQuote(value)}`;
  });
}

/**
 * The full script: tool folders first on PATH, the environment settings, then
 * each step in order. A step runs only if the one before it passed, and the
 * script exits with the exit code of the step that stopped it, or 1 for a
 * program PowerShell could not start, which sets no exit code of its own.
 */
export function projectCommandScript(
  recordedCommands: BuildCommands | undefined,
  steps: CommandStep[],
  cwd: string,
  settings: Record<string, string>,
  toolFolders: string[],
) {
  if (!steps.length || steps.length > MAX_STEPS)
    throw new PlanError(
      "INVALID",
      `Run between 1 and ${MAX_STEPS} recorded commands`,
    );
  const recorded = steps.map((step) => {
    const command = recordedCommands?.[step.name];
    if (!command)
      throw new PlanError(
        "UNRESOLVED",
        `No ${step.name} command is recorded for this project yet; run it with pwsh instead.`,
      );
    return command;
  });
  const commands = steps.map((step, i) =>
    [recorded[i], ...step.args].join(" "),
  );
  const lines = steps.flatMap((step, i) => [
    `Write-Output ${powershellQuote(`> ${commands[i]}`)}`,
    projectCommandLine(recorded[i], step.args, cwd),
    "if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }",
  ]);
  return {
    /** Each command as it runs, with its extra arguments. */
    commands,
    script: [
      ...toolPathLines(toolFolders),
      ...environmentLines(settings),
      ...lines,
      "exit 0",
    ].join("; "),
  };
}

/** Puts the tool folders first on PATH, so commands find the tools DSH ships before any others. */
function toolPathLines(toolFolders: string[]) {
  if (!toolFolders.length) return [];
  return [
    `$env:PATH = ${powershellQuote(toolFolders.join(path.delimiter) + path.delimiter)} + $env:PATH`,
  ];
}

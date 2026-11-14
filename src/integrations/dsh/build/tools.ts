import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { PlanError, text } from "../../../domain/plan.ts";
import type { BuildCommands, PlanMap } from "../../../application/build/index.ts";
import { toolJson } from "../tool-json.ts";
import {
  PROJECT_COMMAND_TOOL,
  RECORD_COMMANDS_TOOL,
  RECORDED_COMMANDS,
  projectCommandScript,
  recordedWords,
  type CommandStep,
} from "./commands.ts";
import type { BuildEnvironment } from "./environment.ts";
import { runPowerShell, tail } from "./recorded-run.ts";
import { PROGRAM_WINDOW_TOOL, useWindow, windowRequest } from "./window.ts";

// The tools BaseSeer adds to the standard coding tools of a build's lead and subagents.

const jsonOutput = {
  schema: { type: "json" as const },
  render: (_args: any, value: any) => [
    { type: "text" as const, text: JSON.stringify(value) },
  ],
};

function refuseOtherAgents(agent: any, exec: any) {
  if (exec.agent !== agent) throw new PlanError("DENIED", "Wrong subagent");
}

const commandProperties = Object.fromEntries(
  RECORDED_COMMANDS.map((key) => [key, { type: "string" as const }]),
);

/** A command as BaseSeer runs it: a plain program call, named for the error it gives. */
function plainCommand(value: unknown, name: string) {
  const command = text(value, name, 500).trim();
  try {
    recordedWords(command);
  } catch (e) {
    throw new PlanError("INVALID", `${name}: ${(e as Error).message}`);
  }
  return command;
}

function recordedCommands(input: any): BuildCommands {
  const commands: Record<string, string> = {};
  for (const key of RECORDED_COMMANDS) {
    const value = input?.[key];
    if (typeof value !== "string" || !value.trim()) continue;
    commands[key] = plainCommand(value, key);
  }
  return commands;
}

/**
 * Whoever sets up a project command records it, so every subagent's runs and
 * BaseSeer's acceptance check run the same commands. A command must be a
 * plain program call, so a subagent learns at once that one is not.
 */
export function recordCommandsTool(
  agent: any,
  record: (commands: BuildCommands, untested?: string) => string,
) {
  return defineTool({
    name: RECORD_COMMANDS_TOOL,
    description: `Record the project's commands (${RECORDED_COMMANDS.join(", ")}) as you set each one up, so you can run them with project_command and BaseSeer's acceptance check runs them too. Each must be a plain program call; recording a name again replaces it. The check does not pass without a test or e2e command; when no test can apply to this project, say why in untested, which the owner is told with the build.`,
    parameters: {
      commands: {
        type: "object",
        additionalProperties: false,
        properties: commandProperties,
      },
      untested: { type: "string" },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      const commands = recordedCommands(args.commands);
      if (!Object.keys(commands).length)
        throw new PlanError("INVALID", "Record at least one command");
      const untested = typeof args.untested === "string" ? args.untested.trim() : "";
      return toolJson({ receipt: record(commands, untested || undefined) }, RECORD_COMMANDS_TOOL);
    },
  });
}

/** DSH's approval service and the sandbox settings that decide when a project command asks the owner first. */
export type HostServices = {
  approval: any;
  shell?: any;
  sandboxPolicy?: any;
};

/** The host's services, or nothing in hosts that cannot ask the owner. */
export function hostServices(
  agentCtx: any,
  ctx: any,
): HostServices | undefined {
  const get = (name: string) => {
    try {
      return agentCtx.get?.(name) ?? ctx.get?.(name);
    } catch {
      return undefined;
    }
  };
  const approval = get("approval");
  if (typeof approval?.request !== "function") return undefined;
  return {
    approval,
    shell: get("shell"),
    sandboxPolicy: get("sandboxPolicy"),
  };
}

/** How much of a project command's output, from its end, the subagent sees. */
const OUTPUT_LIMIT = 12_000;

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

/** The command and any that follow it, in the order they run. */
function commandSteps(args: any): CommandStep[] {
  const then = Array.isArray(args.then) ? args.then : [];
  return [args, ...then].map((step: any) => {
    if (!RECORDED_COMMANDS.includes(step?.name))
      throw new PlanError(
        "INVALID",
        `Name one of the recorded commands: ${RECORDED_COMMANDS.join(", ")}`,
      );
    return { name: step.name, args: stringList(step.args) };
  });
}

function requestedSettings(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlanError("INVALID", "env must map setting names to text");
  return Object.fromEntries(
    Object.entries(value).map(([name, setting]) => [name, String(setting)]),
  );
}

/**
 * The full access build tools need: the Windows sandbox cannot run them
 * (their child processes need pipes it denies). A build's lead gets it when
 * the build starts, and its subagents take it from the lead; otherwise the
 * command asks for it through DSH's approval, which a subagent's refuses.
 */
async function fullAccess(
  host: HostServices,
  exec: any,
  toolName: string,
  reason: string,
) {
  if (host.shell?.sandboxMode === undefined) return { allowed: true as const };
  const standing = host.sandboxPolicy?.resolve?.({ session: exec.agent.session });
  if (standing?.mode === "danger-full-access") return { allowed: true as const };
  const outcome = await host.approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason: `escalate sandbox to danger-full-access: ${reason}`,
    ...(exec.signal ? { signal: exec.signal } : {}),
  });
  return outcome === "allowed-once"
    ? { allowed: true as const }
    : { allowed: false as const, outcome };
}

/** Runs the project's recorded commands in the project folder, with full access. */
export function projectCommandTool(
  agent: any,
  input: { cwd: string; commands(): BuildCommands | undefined },
  environment: BuildEnvironment,
  host: HostServices,
) {
  const runnable = [...RECORDED_COMMANDS];
  return defineTool({
    name: PROJECT_COMMAND_TOOL,
    description: `Run the project's recorded commands (${runnable.join(", ")}) in this folder: one command, optionally with extra arguments such as test files or flags, followed by any in "then", each only if the one before passed. The whole call has a ten-minute time limit; a timeout stops its processes and returns exit code 124 with the captured output. env sets environment settings for every command in the call. Use pwsh for anything else.`,
    parameters: {
      name: { type: "string", required: true, enum: runnable },
      args: { type: "array", items: { type: "string" } },
      env: { type: "object", additionalProperties: true },
      then: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", required: true, enum: runnable },
            args: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      const steps = commandSteps(args);
      const { commands, script } = projectCommandScript(
        input.commands(),
        steps,
        input.cwd,
        { ...environment.settings, ...requestedSettings(args.env) },
        environment.toolFolders,
      );
      const names = steps.map((step) => step.name).join(", then ");
      const access = await fullAccess(
        host,
        exec,
        PROJECT_COMMAND_TOOL,
        `run the project's ${names} (${commands.join("; ")})`,
      );
      if (!access.allowed)
        return toolJson(
          { ran: false, outcome: access.outcome },
          PROJECT_COMMAND_TOOL,
        );
      // The builder and acceptance check use the same command environment and deadline.
      const result = await runPowerShell(script, input.cwd, exec.signal);
      return toolJson(
        {
          ran: true,
          commands,
          exitCode: result.code,
          output: tail(result.output, OUTPUT_LIMIT),
        },
        PROJECT_COMMAND_TOOL,
      );
    },
  });
}

/**
 * A program used in windows, seen and used as its user does: by a session
 * that builds a part, checks the build or uses the program for its owner.
 * Pictures are saved under `folder`, where the session keeps its test output.
 */
export function programWindowTool(agent: any, folder: string) {
  return defineTool({
    name: PROGRAM_WINDOW_TOOL,
    description:
      'See and use a window of a program you started, as its user does. pid is the program\'s process id (Start-Process -PassThru gives it) or that of a process that started it, such as a launcher; the window is that of the process or one it started, the frontmost unless window names part of another\'s title. The steps run in order: {click: "<control>"} presses a button, box, list item or menu by its name or id; {set: "<control>", text} puts text in a field; {keys: "..."} types, in SendKeys notation ("^s", "{ENTER}"); {hold: "<key>", ms} holds a key such as Right or Space; {clickAt: [x, y]} clicks a point of the window\'s picture; {wait: ms} waits for a result to show. click and set act on the window where it is, without the keyboard or mouse; keys, hold and clickAt bring it to the front and use the real ones, for a program that draws its own controls, such as a game. Returns the window\'s controls with their names and places in the picture, and saves the picture, which read_image shows you.',
    parameters: {
      pid: { type: "number", required: true },
      window: { type: "string" },
      steps: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      return toolJson(await useWindow(windowRequest(args), folder, exec.signal), PROGRAM_WINDOW_TOOL);
    },
  });
}

/**
 * The plan as a subagent reads it: BaseSeer's map, read-only, its records
 * exactly and its planned components against the files in the project
 * folder.
 */
export function planMapTool(agent: any, map: PlanMap) {
  return defineTool({
    name: "plan_map",
    description: `Read the project's plan from BaseSeer's map, read-only. command.action: "records" lists every record and link; with ids:[...], it returns those records exactly, with the links that touch them. "coverage" compares each planned component with the files in this folder: built, partial or missing, the files no component plans, and where it could not read the folder whole.`,
    parameters: {
      command: {
        type: "object",
        required: true,
        additionalProperties: true,
        properties: { action: { type: "string" } },
      },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      const action = String(args.command?.action ?? "records");
      if (action === "records") {
        const ids = Array.isArray(args.command?.ids) ? args.command.ids.map(String) : undefined;
        return toolJson(map.records(ids), "plan_map");
      }
      if (action === "coverage") return toolJson(await map.coverage(), "plan_map");
      throw new PlanError("INVALID", 'Use action "records" or "coverage"');
    },
  });
}

/**
 * The lead's check of its build: BaseSeer's acceptance check of the project
 * folder as it is now, run once none of the lead's subagents is working.
 */
export function buildCheckTool(agent: any, check: (fixed: number[]) => Promise<unknown>) {
  return defineTool({
    name: "build_check",
    description:
      'Run BaseSeer\'s acceptance check of this folder as it is now, once none of your subagents is working: the project\'s recorded commands in a clean copy, the way continuous integration would. Returns what fails with its evidence. Once it passes, BaseSeer\'s review reads the owner\'s words against the code and uses the program as its owner will, and the check returns its numbered report; after you have fixed its items, name them to the check: fixed:[item, ...], by their numbers in the report. The next passing check completes the build once every item is fixed.',
    parameters: {
      fixed: { type: "array", items: { type: "number" } },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      return toolJson(await check(Array.isArray(args.fixed) ? args.fixed.map(Number) : []), "build_check");
    },
  });
}

/** Another subagent of the same build, as a subagent addresses it. */
export type Peer = { id: string; task: string; agent: any };

/** The short id a subagent addresses another by, as models write ids. */
const shortId = (id: string) => id.slice(0, 8);

/**
 * A build's subagents work on parts that meet, and DSH lets a subagent
 * message only the session that started it and the ones it starts. So
 * BaseSeer delivers a subagent's message to another of its build directly,
 * rather than through the lead, every one of whose requests carries the
 * whole build so far.
 */
export function buildMessageTool(agent: any, peers: () => Peer[]) {
  return defineTool({
    name: "build_message",
    description:
      'Message another subagent of this build, which works alongside you in this folder: to agree what passes between your parts, or to tell it what you need from its part. {} lists the subagents still working, each with its id and what it was asked to do; {to:"<id>", message:"..."} puts your message in that subagent\'s conversation at its next step, and it answers the same way. A subagent that has finished cannot be messaged: tell the lead instead.',
    parameters: {
      to: { type: "string" },
      message: { type: "string" },
    },
    output: jsonOutput,
    async execute(args: any, exec: any) {
      refuseOtherAgents(agent, exec);
      const working = peers().filter((p) => p.agent !== agent && p.agent.status === "running");
      const subagents = working.map((p) => ({ id: shortId(p.id), task: p.task }));
      if (!args.to) return toolJson({ subagents }, "build_message");
      const to = String(args.to);
      const peer = working.find((p) => p.id === to || shortId(p.id) === to);
      if (!peer)
        return toolJson(
          { sent: false, reason: `No subagent of this build that is still working has the id ${to}.`, subagents },
          "build_message",
        );
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new PlanError("INVALID", "Write the message to send");
      const self = peers().find((p) => p.agent === agent);
      peer.agent.steer({
        id: randomUUID(),
        role: "user",
        source: { kind: "baseseer-build-message" },
        content: [
          {
            type: "text",
            text: `Subagent ${shortId(agent.id)} of this build${self?.task ? ` (asked to: ${self.task})` : ""} sent you this with build_message, which you answer it with:\n\n${message}`,
          },
        ],
      });
      return toolJson({ sent: true }, "build_message");
    },
  });
}

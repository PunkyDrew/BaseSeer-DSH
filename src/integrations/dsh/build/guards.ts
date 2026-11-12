import path from "node:path";
import { PROJECT_COMMAND_TOOL } from "./commands.ts";
import { PROGRAM_WINDOW_TOOL } from "./window.ts";

// What a build's lead and subagents may not do, and why. Each guard refuses
// a call with a reason the session can act on, rather than failing it silently.

const OWN_GOAL =
  "Your part of the build is your goal; DSH goals need the owner's own turn, and the owner does not watch a build's sessions.";

/**
 * Tools a build's sessions do not get, with the reason one is given if it
 * calls one. The owner does not watch them, so a file one presents goes
 * unseen while the call spends a step, and a question one asks in the page
 * waits for an answer that never comes, holding the build; DSH refuses goals
 * to subagents, so each try is a wasted step; and a fork runs on its parent's
 * model, not the one the plan gives the part, with the parent's whole
 * conversation.
 */
export const WITHHELD_TOOLS: Record<string, string> = {
  present:
    "The owner does not watch this session and does not see presented files; name what you made in your report instead.",
  ask_user_question:
    "No one watches this session to answer. Decide as your instructions say; where only the owner or the planner can decide, end your turn with the question (a subagent, in its report to the lead), and BaseSeer passes it on.",
  subagent_fork:
    "Start a subagent with the subagent tool, on the model the plan gives its components: a fork runs on this session's model and carries its whole conversation.",
  create_goal: OWN_GOAL,
  get_goal: OWN_GOAL,
  update_goal: OWN_GOAL,
};

/**
 * The tools the build's reviewers use: they read, run and use the project,
 * and change nothing in it. A list of what they may use rather than of what
 * they may not, since the host can offer more tools than DSH's own, such as
 * an MCP server's, which could change the project or reach past the tester's
 * copy of it.
 */
const REVIEW_TOOLS = [
  "read",
  "read_image",
  "grep",
  "glob",
  "pwsh",
  "bash",
  "job_output",
  "job_list",
  "job_kill",
  "todo_write",
  "web_search",
  "web_fetch",
  PROJECT_COMMAND_TOOL,
  PROGRAM_WINDOW_TOOL,
];

const REVIEW_ONLY =
  "BaseSeer's review changes nothing in the project and starts no other session: read, run and use the program with your other tools, and report what you find.";

/** Hides every other tool from a reviewer and refuses it if the reviewer calls one. */
export function reviewOnly(agentCtx: any, agent: any) {
  for (const { name } of agentCtx.tools?.schemas?.(agent) ?? [])
    if (!REVIEW_TOOLS.includes(name))
      try {
        agentCtx.tools.restrict({ deny: [name] });
      } catch {
        /* Not one this session inherits; the guard below refuses it all the same. */
      }
  agentCtx.tools?.guard?.((exec: any) =>
    exec?.agent === agent && !REVIEW_TOOLS.includes(exec?.name) ? REVIEW_ONLY : undefined,
  );
}

/** DSH's shell tools resolve relative workdirs against the session's effective directory. */
const SHELLS = ["pwsh", "bash"];

/**
 * DSH lists a chat among a project's chats only when the chat's folder is the
 * project folder, so a review session sits there while the use test works in
 * a copy: its commands start in `folder`, so the program it runs keeps its data
 * out of the project.
 */
export function commandsIn(agent: any, folder: string) {
  return (exec: any) => {
    if (exec?.agent !== agent || !SHELLS.includes(exec?.name)) return undefined;
    const workdir = exec.arguments?.workdir;
    const refusal = `Run your commands in ${folder}: pass its absolute path as workdir.`;
    // An effective directory can change or recover to the original project
    // after this guard; only an absolute override keeps shell execution scoped.
    if (typeof workdir !== "string" || !path.isAbsolute(workdir)) return refusal;
    const where = path.relative(folder, path.resolve(workdir));
    return where === ".." || where.startsWith(`..${path.sep}`) || path.isAbsolute(where) ? refusal : undefined;
  };
}

/** The tools the validation reads with: it changes nothing, runs nothing and starts no other session. */
const VALIDATION_TOOLS = ["read", "read_image", "grep", "glob", "plan_map", "web_search", "web_fetch"];

const VALIDATION_ONLY =
  "BaseSeer's validation reads and reports: it changes nothing, runs nothing and starts no other session. Read, search and report what you find.";

/** Refuses the validation every tool but those that read, so it needs no access beyond the default. */
export function readOnly(agentCtx: any, agent: any) {
  agentCtx.tools?.guard?.((exec: any) =>
    exec?.agent === agent && !VALIDATION_TOOLS.includes(exec?.name) ? VALIDATION_ONLY : undefined,
  );
}

/** Hides the withheld tools from this session's own tool list. */
export function hideWithheldTools(agentCtx: any) {
  for (const name of Object.keys(WITHHELD_TOOLS))
    try {
      agentCtx.tools?.restrict?.({ deny: [name] });
    } catch {
      /* Not registered for this agent yet; the plugin's guard refuses it. */
    }
}

/**
 * A build's session can be woken after its build ends, by DSH's notice that
 * a session it started has stopped or by another session's message. Its
 * work then would land outside the build, after the owner's stop or the
 * passing check, so it gets no tools at all.
 */
export const BUILD_ENDED =
  "BaseSeer: the build you worked for has ended, so you have no tools now. End your turn without further work.";

/**
 * Refuses the withheld tools to a build's lead, the sessions it starts and
 * the ones those start in turn, and every tool once their build has ended. A
 * guard on one session's own context does not reach the sessions it starts,
 * so this one is the plugin's, and asks how each session's build stands.
 */
export function withholdFromBuilds(ctx: any, build: (session: string) => "running" | "ended" | undefined) {
  ctx.tools?.guard?.((exec: any) => {
    const state = exec?.agent && build(exec.agent.id);
    if (state === "ended") return BUILD_ENDED;
    return state ? WITHHELD_TOOLS[exec?.name] : undefined;
  });
}

/** Shortest wait BaseSeer accepts for a subagent's background job (DSH caps the longest). */
export const MIN_JOB_WAIT_MS = 60_000;

/**
 * A subagent that polls a background job over and over resends the whole
 * conversation with each check. The first look at a job stays allowed, for
 * example a dev server's startup output; after that it waits for the job,
 * which returns as soon as it ends.
 */
export function pollingGuard(agent: any) {
  const looked = new Set<string>();
  return (exec: any) => {
    if (exec?.agent !== agent || exec?.name !== "job_output") return undefined;
    const args = exec.arguments ?? {};
    const job = String(args.job_id ?? "");
    const wait = `job_output {job_id: "${job}", wait: true, timeout_ms: 600000}`;
    if (args.wait === true)
      return typeof args.timeout_ms === "number" &&
        args.timeout_ms >= MIN_JOB_WAIT_MS
        ? undefined
        : `Wait long enough for the job to finish: ${wait}. It returns as soon as the job ends; short waits resend the whole conversation for nothing.`;
    if (!looked.has(job)) {
      looked.add(job);
      return undefined;
    }
    return `Do not check a job again and again: every check resends the whole conversation. Wait for it with ${wait}; it returns as soon as the job ends.`;
  };
}

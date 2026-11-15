import path from "node:path";
import { PROJECT_COMMAND_TOOL } from "./commands.ts";
import { PROGRAM_WINDOW_TOOL } from "./window.ts";
import { PLAN_FOLDER } from "../../../storage/project-folder.ts";

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

/** The tools a validation or plan review reads with: it changes nothing, runs nothing and starts no other session. */
const READING_TOOLS = ["read", "read_image", "grep", "glob", "plan_map", "web_search", "web_fetch"];

const READING_ONLY =
  "This BaseSeer session reads and reports: it changes nothing, runs nothing and starts no other session. Read, search and report what you find.";

/** Refuses a validation or plan review every tool but those that read, so it needs no access beyond the default. */
export function readOnly(agentCtx: any, agent: any) {
  agentCtx.tools?.guard?.((exec: any) =>
    exec?.agent === agent && !READING_TOOLS.includes(exec?.name) ? READING_ONLY : undefined,
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

export const PLAN_FOLDER_KEPT = `BaseSeer: ${PLAN_FOLDER} holds the project's plan and its changes since the last commit, which no other copy holds, so a build may not remove, reset or rewrite it, or run a command that could. The plan stays as it is: read it with plan_map, and carry on with your work outside ${PLAN_FOLDER}, naming the files you mean to change.`;

/**
 * The plan folder named as a path segment, the way a path or a patch names it.
 * The folder is at the project's root, so a wildcard that could match it there
 * (`.base*`, `.b*`, `*`) names it too, as does one in any segment that starts
 * with a dot, which an absolute path to the project ends in.
 */
const NAMES_PLAN = new RegExp(`(^|[\\s"'\`=(,\\\\/])${PLAN_FOLDER.replace(".", "\\.")}(?=[\\s"'\`),;\\\\/]|$)`);
const ROOT_WILDCARDS = /(?:^|[\s"'`=(,])(?:\.[\\/])?([^\s"'`=(,\\/;|&]*[*?][^\s"'`\\/;|&]*)/g;
const DOT_WILDCARDS = /[\\/](\.[^\s"'`\\/;|&]*[*?][^\s"'`\\/;|&]*)/g;

/** Whether a wildcard path segment would match the plan folder. */
function matchesPlan(segment: string) {
  const pattern = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${pattern}$`, "i").test(PLAN_FOLDER);
}

/** Whether text names the plan folder, by its name or by a wildcard that matches it. */
function namesPlanFolder(text: string) {
  if (NAMES_PLAN.test(text)) return true;
  return [...text.matchAll(ROOT_WILDCARDS), ...text.matchAll(DOT_WILDCARDS)].some(([, segment]) =>
    matchesPlan(segment),
  );
}

/**
 * The tools that only read what a path names, which may name the plan
 * folder; any other tool given a path or patch in it (DSH's write and edit,
 * an MCP server's file tools) would change it.
 */
const READS_PATHS = ["read", "read_image", "grep", "glob", "plan_map"];

/** The arguments that hold a path or a patch, as against a message or a file's new content. */
const PATH_ARGUMENT = /path|file|patch|input|target|dest|source|dir/i;

/**
 * Words that delete, move or write what they name, in the shells and in a
 * script run from one (`fs.rmSync`, `shutil.rmtree`, `os.remove`): a command
 * that has one and names the plan folder could change it. Copying only out
 * of the folder is reading, so copies are judged by their destination instead.
 */
const CHANGES_FILES =
  /\b(remove-item|rename-item|move-item|set-content|add-content|clear-content|clear-item|out-file|new-item|tee-object|tee|robocopy|rmtree|rename|ren|mv|move|rmdir|rm|rd|del|erase|remove|unlink|truncate|writefile|appendfile|write_text|write_bytes)(sync)?\b/i;

/** A copy and its arguments, up to the end of its command. */
const COPIES = /\b(copy-item|cp|copy|xcopy|copyfile)(sync)?\b([^;|&\n]*)/gi;

/** Output redirected into the plan folder. */
const REDIRECTS_INTO_PLAN = new RegExp(`>\\s*["']?[^\\s;|&<>]*${PLAN_FOLDER.replace(".", "\\.")}`);

/**
 * A delete of everything in the folder it runs in (`rm -rf *`, `Remove-Item
 * . -Recurse`), which takes the plan folder with it without naming it.
 */
const DELETES_EVERYTHING =
  /\b(remove-item|rmdir|rm|rd|del|erase)\b[^;|&\n]*?\s["']?(\.{1,2}([\\/]\*?)?|\.?\*)["']?(?=\s|$|[;|&])/i;

/** Git subcommands and their arguments, up to the end of each command. */
const GIT_COMMANDS = /\bgit\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*([a-z][\w-]*)([^;|&\n]*)/gi;

/** Whether a copy's destination, its `-Destination` or else its last argument, is in the plan folder. */
function copiesIntoPlan(argumentText: string) {
  const words = argumentText.trim().split(/\s+/);
  const flag = words.findIndex((word) => /^-destination$/i.test(word));
  const destination = flag >= 0 ? words[flag + 1] : words.at(-1);
  return Boolean(destination && namesPlanFolder(destination));
}

/**
 * Whether a Git command discards changes the plan file may hold, or the plan
 * folder itself, without having to name it: a hard reset, a stash, a clean,
 * or a checkout or restore of the whole tree or of the folder.
 */
function discardsWork(subcommand: string, argumentText: string) {
  const words = argumentText.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/["']/g, ""));
  const wholeTreeOrPlan = words.some((word) =>
    [".", "./", "*", ":/"].includes(word) || word.includes(PLAN_FOLDER),
  );
  switch (subcommand.toLowerCase()) {
    case "clean":
      return !words.some((word) => word === "--dry-run" || /^-[a-z]*n[a-z]*$/i.test(word));
    case "reset":
      return words.includes("--hard");
    case "stash":
      return !["list", "show"].includes(words[0] ?? "");
    case "checkout":
      return wholeTreeOrPlan;
    case "restore": {
      const stagedOnly =
        words.some((word) => word === "--staged" || word === "-S") &&
        !words.some((word) => word === "--worktree" || word === "-W");
      return !stagedOnly && wholeTreeOrPlan;
    }
    default:
      return false;
  }
}

/** Whether a shell command could remove, reset or rewrite the plan folder. */
function commandChangesPlan(command: string) {
  if (DELETES_EVERYTHING.test(command)) return true;
  for (const [, subcommand, argumentText] of command.matchAll(GIT_COMMANDS))
    if (discardsWork(subcommand, argumentText)) return true;
  if (!namesPlanFolder(command)) return false;
  if (CHANGES_FILES.test(command) || REDIRECTS_INTO_PLAN.test(command)) return true;
  return [...command.matchAll(COPIES)].some(([, , , argumentText]) => copiesIntoPlan(argumentText));
}

/** Whether a tool other than a shell is given a path or patch in the plan folder. */
function pathsChangePlan(name: string, args: Record<string, unknown>) {
  if (READS_PATHS.includes(name)) return false;
  return Object.entries(args).some(
    ([key, value]) => PATH_ARGUMENT.test(key) && namesPlanFolder(JSON.stringify(value) ?? ""),
  );
}

/** Why a call would remove, reset or rewrite the plan folder, if it would. */
function touchesPlanFolder(exec: any) {
  const args = exec?.arguments ?? {};
  const changes = SHELLS.includes(exec?.name)
    ? commandChangesPlan(String(args.command ?? ""))
    : pathsChangePlan(String(exec?.name), args);
  return changes ? PLAN_FOLDER_KEPT : undefined;
}

/**
 * Refuses the withheld tools to a build's lead, the sessions it starts and
 * the ones those start in turn, and every tool once their build has ended;
 * while it runs, a call that would remove or rewrite the plan folder is
 * refused too. A guard on one session's own context does not reach the
 * sessions it starts, so this one is the plugin's, and asks how each
 * session's build stands.
 */
export function withholdFromBuilds(ctx: any, build: (session: string) => "running" | "ended" | undefined) {
  ctx.tools?.guard?.((exec: any) => {
    const state = exec?.agent && build(exec.agent.id);
    if (state === "ended") return BUILD_ENDED;
    if (!state) return undefined;
    return WITHHELD_TOOLS[exec?.name] ?? touchesPlanFolder(exec);
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

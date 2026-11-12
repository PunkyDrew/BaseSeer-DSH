import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as git from "../../../application/build/git.ts";
import { projectCommandScript } from "./commands.ts";

/**
 * The surroundings BaseSeer gives every subagent of a build: the tools DSH ships, which
 * its commands find first, its own port and the browsers installed on this
 * machine. The self-check below proves them before any model is paid to use
 * them.
 */
export type BuildEnvironment = {
  /** Folders put first on PATH for project commands. */
  toolFolders: string[];
  /** Settings every project command gets, such as the subagent's PORT. */
  settings: Record<string, string>;
  port?: number;
  browsers: InstalledBrowser[];
};

export type InstalledBrowser = {
  name: string;
  /** The name Playwright launches it by, when it has one. */
  channel?: string;
  path: string;
};

const samePath = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * Where the acceptance check's copies of a project live. A packaged host can redirect its
 * data folder (DSH inside the Codex app keeps it under the package's
 * LocalCache), which gives every file two paths: builds and tests started
 * from one path cannot load or start files that tools resolve to the other.
 * The copies then go in the home folder, which has a single path.
 */
export function buildFoldersRoot(preferred: string, home = os.homedir()) {
  fs.mkdirSync(preferred, { recursive: true });
  if (samePath(fs.realpathSync.native(preferred), preferred)) return preferred;
  return path.join(home, ".baseseer", "builds");
}

/**
 * The folder put first on PATH for project commands: DSH's own runtime,
 * with the Node that runs DSH and the package managers DSH ships beside it.
 */
export const toolFolders = (runtime = process.execPath) => [path.dirname(runtime)];

const TOOL = /^(node|npm|npx|pnpm|pnpx|yarn|corepack)(.exe|.cmd)?$/i;

/** The Node and package manager programs in a tool folder, by name. */
function toolsIn(folder: string) {
  try {
    return [...new Set(fs.readdirSync(folder).filter((f) => TOOL.test(f)).map((f) => f.replace(/.(exe|cmd)$/i, "")))].sort();
  } catch {
    return [];
  }
}

/** Where each browser installs itself, per platform. */
function browserLocations(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): InstalledBrowser[] {
  if (platform === "win32") {
    const programs = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
      (folder): folder is string => !!folder,
    );
    const local = env.LOCALAPPDATA;
    return [
      ...programs.map((folder) => ({
        name: "Microsoft Edge",
        channel: "msedge",
        path: path.join(folder, "Microsoft", "Edge", "Application", "msedge.exe"),
      })),
      ...[...programs, ...(local ? [local] : [])].map((folder) => ({
        name: "Google Chrome",
        channel: "chrome",
        path: path.join(folder, "Google", "Chrome", "Application", "chrome.exe"),
      })),
    ];
  }
  if (platform === "darwin")
    return [
      {
        name: "Microsoft Edge",
        channel: "msedge",
        path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      },
      {
        name: "Google Chrome",
        channel: "chrome",
        path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
    ];
  return [
    { name: "Microsoft Edge", channel: "msedge", path: "/usr/bin/microsoft-edge" },
    { name: "Google Chrome", channel: "chrome", path: "/usr/bin/google-chrome" },
    { name: "Chromium", path: "/usr/bin/chromium" },
  ];
}

/** The browsers that are installed here, each listed once. */
export function installedBrowsers(
  platform = process.platform,
  env = process.env,
): InstalledBrowser[] {
  const found = new Map<string, InstalledBrowser>();
  for (const browser of browserLocations(platform, env))
    if (!found.has(browser.name) && fs.existsSync(browser.path))
      found.set(browser.name, browser);
  return [...found.values()];
}

/**
 * Project commands run the way continuous integration runs a project's
 * checks: test tools then skip watch modes and prompts, and the delivered
 * checks are proven where others will run them; a browser test that passes
 * without CI set can fail with it.
 */
const CONTINUOUS_INTEGRATION = { CI: "1" };

/** Everything a subagent needs from its surroundings. */
export function buildEnvironment(
  port: number | undefined,
  browsers: InstalledBrowser[],
): BuildEnvironment {
  return {
    toolFolders: toolFolders(),
    settings: {
      ...CONTINUOUS_INTEGRATION,
      ...(port ? { PORT: String(port) } : {}),
    },
    ...(port ? { port } : {}),
    browsers,
  };
}

/** What a build's session is told about its surroundings, in its system prompt. */
export function environmentBriefing(environment: BuildEnvironment) {
  const lines = environment.toolFolders.map((folder) => {
    const tools = toolsIn(folder);
    return `${tools.length ? tools.join(", ") : "Node"} ${tools.length === 1 ? "is" : "are"} in ${folder}, which project_command puts first on PATH; pwsh's PATH does not have it, so give that folder in pwsh.`;
  });
  lines.push("project_command sets CI, as continuous integration does, so the project's checks must pass with it set.");
  if (environment.port)
    lines.push(
      `Start any server the project runs on your own port, ${environment.port}, which project_command passes as PORT, and never use a server that is already running.`,
    );
  if (environment.browsers.length)
    lines.push(
      `Browsers installed here, for anything the project tests in a browser: ${environment.browsers.map((b) => `${b.channel ? `${b.name} (channel "${b.channel}")` : b.name} at ${b.path}`).join(", ")}. Use these rather than downloading one. Each runs headless and can be driven through its remote-debugging port (--remote-debugging-port) by any WebSocket client, so a test can open the project's pages and use them as their user does.`,
    );
  return lines.join(" ");
}

function removeFolder(folder: string) {
  fs.rmSync(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

/**
 * The PowerShell BaseSeer runs project commands in: a subagent's, the machine
 * check's and the acceptance check's.
 */
export function localPowerShell() {
  if (process.platform === "win32") return "powershell.exe";
  const found = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]);
  return found.status === 0 ? "pwsh" : undefined;
}

// Names DSH's own process runner keeps out of every command it starts.
const CREDENTIAL = /KEY|PASSWORD|SECRET|TOKEN/i;

/**
 * A project's packages and tools stay in its folder. Pip installs into the
 * Python that runs it, which is the machine's own unless the project has a
 * virtual environment, so it is made to refuse to install outside one; the
 * .NET SDK adds its tools folder to the user's PATH on its first use in each
 * home, so a project's own SDK would add one for every copy it runs in.
 */
const PROJECT_INSTALLS = { PIP_REQUIRE_VIRTUALENV: "1", DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: "0" };

/**
 * The environment a project command starts with: BaseSeer's own, without the
 * credentials its host was given, such as a model provider's API key, and
 * without DSH's own settings, as DSH leaves them out of its commands.
 */
export function commandEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !CREDENTIAL.test(name) && !name.toUpperCase().startsWith("DSH_"),
      ),
    ),
    ...PROJECT_INSTALLS,
  };
}

/**
 * What every project on this machine shares, by what each holds: the
 * packages of the Python project commands find, and on Windows npm's global
 * packages and Playwright's browsers, dotnet's global tools and the user's
 * PATH, where whatever installs a tool for every program registers it. A
 * project's own dependencies and tools never go into them.
 */
export function machineTools(): Record<string, string[]> {
  const python = spawnSync(
    "python",
    ["-c", "import site, sysconfig; print(sysconfig.get_paths()['purelib']); print(site.getusersitepackages())"],
    { encoding: "utf8", env: commandEnvironment(), windowsHide: true },
  );
  const folders = [
    ...(python.status === 0 ? python.stdout.trim().split(/\r?\n/) : []),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm", "node_modules")] : []),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "ms-playwright")] : []),
    path.join(os.homedir(), ".dotnet", "tools"),
  ];
  // Python writes its own compiled caches where it runs, which installs nothing.
  const held = (folder: string) =>
    fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name !== "__pycache__").sort() : [];
  return {
    ...Object.fromEntries(folders.map((folder) => [folder, held(folder)])),
    ...(process.platform === "win32" ? { "the user's PATH": userPath() } : {}),
  };
}

/** The user's PATH as Windows keeps it for programs started from now on, which no running program's PATH shows. */
function userPath() {
  const query = spawnSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8", windowsHide: true });
  const value = query.stdout?.match(/^\s*Path\s+REG_\w+\s+(.*)$/im)?.[1] ?? "";
  return value.split(";").map((entry) => entry.trim()).filter(Boolean).sort();
}

function checkSinglePath(folder: string) {
  const real = fs.realpathSync.native(folder);
  return samePath(real, folder)
    ? []
    : [
        `Build folders have two paths (${folder} resolves to ${real}), so build tools would fail to load their files.`,
      ];
}

// A command run exactly as a recorded command runs: with the tool folder on
// PATH, a PORT of its own, from the folder it runs in.
function checkProjectCommand(folder: string, port: number) {
  const shell = localPowerShell();
  if (!shell) return ["Project commands need PowerShell, which is not installed here."];
  fs.writeFileSync(
    path.join(folder, "probe.cjs"),
    `const fs = require("node:fs");\nconst single = fs.realpathSync.native(process.cwd()).toLowerCase() === process.cwd().toLowerCase();\nconsole.log("probe " + process.env.PORT + " " + single);\n`,
  );
  const { script } = projectCommandScript(
    { test: "node probe.cjs" },
    [{ name: "test", args: [] }],
    folder,
    { PORT: String(port) },
    toolFolders(),
  );
  const run = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: folder,
      env: commandEnvironment(),
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    },
  );
  if (run.status === 0 && run.stdout.includes(`probe ${port} true`)) return [];
  const detail = run.error?.message || run.stderr || run.stdout || "No output was captured.";
  return [
    `A recorded command could not run in a build folder (exit ${run.status ?? "none"}): ${detail.trim().split(/\r?\n/).slice(-3).join(" ")}`,
  ];
}

// A project's .gitignore may list .baseseer; its work must still reach the check's copy.
function checkSnapshot(folder: string) {
  // This disposable probe needs its own repository even when the data folder is inside one.
  git.buildGit(folder, ["init", "--quiet"]);
  fs.writeFileSync(path.join(folder, ".gitignore"), ".baseseer/\n");
  const snapshot = git.snapshot(folder, undefined, "environment check");
  const files = git.buildGit(folder, ["ls-tree", "-r", "--name-only", snapshot]).stdout;
  return files.includes("probe.cjs") && !files.includes(".baseseer/")
    ? []
    : ["A project's work could not be copied for the acceptance check."];
}

/**
 * Proves the surroundings a build will get, by doing what it does in a
 * scratch folder: run a recorded command and snapshot the folder's work. It
 * needs no model, so a broken machine fails here, in seconds, instead of
 * partway through a paid build.
 */
export async function checkBuildEnvironment(
  buildsRoot: string,
  firstPort: number,
): Promise<string[]> {
  const folder = path.join(buildsRoot, `environment-check-${randomUUID()}`);
  fs.mkdirSync(folder, { recursive: true });
  try {
    const problems = checkSinglePath(folder);
    if (problems.length) return problems;
    return [
      ...checkProjectCommand(folder, firstPort),
      ...checkSnapshot(folder),
    ];
  } catch (e) {
    return [`The build environment check failed: ${(e as Error).message}`];
  } finally {
    removeFolder(folder);
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PlanError } from "../../domain/plan.ts";

// Git plumbing for whole-project builds. Builds never move the project's
// branch, index or commits until the owner commits one: snapshots of the
// project folder are commit objects kept under refs/baseseer/.

/** Never captured in a snapshot of the project folder. */
const BUILD_EXCLUDES = [
  ":(exclude).baseseer",
  ":(exclude,glob)**/node_modules/**",
  ":(exclude,glob)**/.venv/**",
  ":(exclude,glob)**/venv/**",
  ":(exclude,glob)**/__pycache__/**",
  ":(exclude,glob)**/.pnpm-store/**",
];

type GitOptions = {
  input?: string | Buffer;
  index?: string;
  allowFail?: boolean;
  /** Use the repository's own author identity (the owner's commit). */
  owner?: boolean;
};
type GitResult = { status: number; stdout: string; stderr: string };

export function buildGit(
  root: string,
  args: string[],
  options: GitOptions = {},
): GitResult {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  if (options.index) env.GIT_INDEX_FILE = options.index;
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgsign=false",
      ...(options.owner
        ? []
        : [
            "-c",
            "user.name=BaseSeer",
            "-c",
            "user.email=baseseer@localhost.invalid",
          ]),
      ...args,
    ],
    {
      cwd: root,
      env,
      input: options.input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.error)
    throw new PlanError("SOURCE", `Git could not run: ${result.error.message}`);
  const out = {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  if (out.status !== 0 && !options.allowFail)
    throw new PlanError(
      "SOURCE",
      `git ${args[0]} failed: ${out.stderr.trim().split(/\r?\n/).slice(-3).join(" ") || `exit ${out.status}`}`,
    );
  return out;
}

const same = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * The project folder must be the top of its own Git repository. A folder with
 * no repository gets one; a folder nested inside another repository is refused.
 */
export function ensureRepository(root: string) {
  const real = fs.realpathSync(root);
  const top = buildGit(real, ["rev-parse", "--show-toplevel"], {
    allowFail: true,
  });
  if (top.status !== 0) {
    buildGit(real, ["init", "--quiet"]);
    return { initialized: true };
  }
  if (!same(fs.realpathSync(top.stdout.trim()), real))
    throw new PlanError(
      "SOURCE",
      "This project folder is inside another Git repository. Open the repository's top folder as the workspace, or give the project its own repository.",
    );
  return { initialized: false };
}

export function head(root: string): string | undefined {
  const r = buildGit(
    root,
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    { allowFail: true },
  );
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function withIndex<T>(fn: (index: string) => T): T {
  const index = path.join(os.tmpdir(), `baseseer-${randomUUID()}.index`);
  try {
    return fn(index);
  } finally {
    for (const f of [index, `${index}.lock`]) fs.rmSync(f, { force: true });
  }
}

/**
 * git add refuses any exclude that touches a folder the project's .gitignore
 * ignores. When a project ignores .baseseer, git already skips it, so that
 * exclude is left out.
 */
function captureExcludes(dir: string) {
  // --no-index: a folder holding a tracked plan file still counts as ignored.
  const ignored =
    buildGit(dir, ["check-ignore", "-q", "--no-index", ".baseseer"], {
      allowFail: true,
    }).status === 0;
  return ignored
    ? BUILD_EXCLUDES.filter((exclude) => !exclude.includes(".baseseer"))
    : BUILD_EXCLUDES;
}

/** Commit the folder's current files (tracked and new, honoring .gitignore). */
export function snapshot(
  dir: string,
  parent: string | undefined,
  message: string,
): string {
  return withIndex((index) => {
    if (parent) buildGit(dir, ["read-tree", parent], { index });
    buildGit(dir, ["add", "-A", "--", ".", ...captureExcludes(dir)], {
      index,
    });
    const tree = buildGit(dir, ["write-tree"], { index }).stdout.trim();
    return buildGit(dir, [
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : []),
      "-m",
      message,
    ]).stdout.trim();
  });
}

export function protect(root: string, name: string, commit: string) {
  buildGit(root, ["update-ref", `refs/baseseer/${name}`, commit]);
}

export function release(root: string, prefix: string) {
  const refs = buildGit(
    root,
    ["for-each-ref", "--format=%(refname)", `refs/baseseer/${prefix}`],
    {
      allowFail: true,
    },
  )
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  for (const ref of refs)
    buildGit(root, ["update-ref", "-d", ref], { allowFail: true });
}

/**
 * Puts a clean worktree of the project at `dir` on `commit`. One already
 * there is reset rather than made again: it holds the commit's files and
 * nothing else, but for `installed`, the ignored paths the project's
 * install left there last time, which stay, as continuous integration
 * restores its dependency caches before it runs.
 */
export function checkout(root: string, dir: string, commit: string, installed: string[] = []) {
  if (worktreeOf(root, dir)) {
    buildGit(dir, ["checkout", "--detach", "--force", commit]);
    buildGit(dir, ["clean", "-d", "-x", "--force", "--quiet", ...installed.flatMap((kept) => ["-e", kept])]);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  buildGit(root, ["worktree", "prune"], { allowFail: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  buildGit(root, ["worktree", "add", "--detach", "--force", dir, commit]);
}

/** What the project's .gitignore ignores in a worktree, each as the pattern that matches it alone. */
export function ignored(dir: string) {
  return buildGit(dir, ["status", "--ignored", "--porcelain", "-z"])
    .stdout.split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => `/${entry.slice(3).replace(/[*?[\\]/g, "\\$&")}`);
}

/** Whether `dir` is a worktree of the repository at `root`. */
function worktreeOf(root: string, dir: string) {
  if (!fs.existsSync(path.join(dir, ".git"))) return false;
  const repository = (folder: string) =>
    buildGit(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], { allowFail: true }).stdout.trim();
  const theirs = repository(dir);
  return !!theirs && same(theirs, repository(root));
}

export type PathChange = { status: "A" | "M" | "D"; path: string };

export function changes(root: string, from: string, to: string): PathChange[] {
  const out = buildGit(root, [
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    from,
    to,
    "--",
    ".",
    ...BUILD_EXCLUDES,
  ]).stdout;
  const parts = out.split("\0").filter((p) => p !== "");
  const result: PathChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i][0];
    result.push({
      status: status === "A" || status === "D" ? status : "M",
      path: parts[i + 1],
    });
  }
  return result;
}

/** Every file a commit holds, by its path in the project. */
export function files(root: string, commit: string) {
  return buildGit(root, ["ls-tree", "-r", "-z", "--name-only", commit])
    .stdout.split("\0")
    .filter(Boolean);
}

/**
 * Commit a finished build for the owner. When the branch is still where the
 * build started and nothing is staged, the branch moves to one new commit with
 * the build's files (the folder already has them, so no file is rewritten).
 * Otherwise the commit goes on a new branch from the starting point.
 */
export function commitBuild(
  root: string,
  input: {
    start: string | undefined;
    result: string;
    message: string;
    branch: string;
  },
) {
  const current = head(root);
  const onBranch = current === input.start;
  if (
    onBranch &&
    buildGit(root, ["diff", "--cached", "--quiet"], { allowFail: true })
      .status !== 0
  )
    throw new PlanError(
      "CONFLICT",
      "Files are staged in this project. Commit or unstage them, then commit the build.",
    );
  // The plan file travels with the project, so it is included.
  const tree = withIndex((index) => {
    buildGit(root, ["read-tree", input.result], { index });
    buildGit(root, ["add", "-A", "--", ".baseseer"], {
      index,
      allowFail: true,
    });
    return buildGit(root, ["write-tree"], { index }).stdout.trim();
  });
  const parent = onBranch ? current : input.start;
  const args = [
    "commit-tree",
    tree,
    ...(parent ? ["-p", parent] : []),
    "-m",
    input.message,
  ];
  // The owner's own Git identity when configured, else BaseSeer's.
  const made = buildGit(root, args, { owner: true, allowFail: true });
  const commit = (
    made.status === 0 ? made : buildGit(root, args)
  ).stdout.trim();
  const files = (
    parent
      ? changes(root, parent, commit).map((c) => c.path)
      : buildGit(root, ["ls-tree", "-r", "--name-only", commit])
          .stdout.split(/\r?\n/)
          .filter(Boolean)
  ).length;
  if (onBranch) {
    buildGit(root, [
      "update-ref",
      "-m",
      "BaseSeer: commit build",
      "HEAD",
      commit,
      ...(current ? [current] : []),
    ]);
    buildGit(root, ["read-tree", commit]);
    const name = buildGit(
      root,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { allowFail: true },
    ).stdout.trim();
    return { commit, branch: name || undefined, moved: false, files };
  }
  let name = input.branch;
  for (let n = 2; ; n++) {
    const exists = buildGit(
      root,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
      { allowFail: true },
    );
    if (exists.status !== 0) break;
    name = `${input.branch}-${n}`;
  }
  buildGit(root, ["update-ref", `refs/heads/${name}`, commit]);
  return { commit, branch: name, moved: true, files };
}

import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { safePath } from "./source.ts";
import { PlanError } from "../domain/plan.ts";
export interface Snapshot {
  source: string;
  branch: string;
  head: string;
  tree: string;
  digest: string;
  build: string;
  files: Record<string, string>;
  dirty?: boolean;
  configuration?: string;
}
const sha = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export function snapshot(root: string, source: string): Snapshot {
  const git = (args: string[]) => {
    const r = spawnSync(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (r.status !== 0)
      throw new PlanError("SOURCE", "Cannot establish fixture Git context");
    return r.stdout.trim();
  };
  const files: Record<string, string> = {};
  for (const name of [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    ),
  ].sort())
    files[name] = sha(fs.readFileSync(safePath(root, name)));
  return {
    source,
    branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    digest: sha(JSON.stringify(files)),
    files,
    dirty: git(["status", "--porcelain", "--untracked-files=all"]).length > 0,
    configuration: sha(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(files).filter(([name]) =>
            /(^|\/)(package\.json|.*lock.*|tsconfig.*\.json|Cargo\.toml|CMakeLists\.txt)$/.test(
              name,
            ),
          ),
        ),
      ),
    ),
    build:
      "stage0-notes-fixture-v1; controlled file writes only; no project scripts",
  };
}

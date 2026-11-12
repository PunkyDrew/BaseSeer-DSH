import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Where a project keeps what BaseSeer knows about it. `.baseseer/plan.json` is
// the plan and travels with the project: commit it. `.baseseer/local/` is this
// machine's record of the project (builds, usage receipts, the code map and
// other caches) and is ignored by git, so a clone starts with the plan alone.
export const PLAN_FOLDER = ".baseseer";
export const PLAN_FILE = "plan.json";
export const LOCAL_FOLDER = "local";

const README =
  "BaseSeer plan for this project: plan.json is the plan map and its history. Keep it with the project (it is safe to commit).\nA BaseSeer workspace opened on this folder loads it and maps the code it finds here. local/ is this machine's record of builds, usage and caches; git ignores it.\n";
const IGNORED = `${LOCAL_FOLDER}/`;

export const planFolder = (root: string) => path.join(root, PLAN_FOLDER);
export const planFile = (root: string) => path.join(root, PLAN_FOLDER, PLAN_FILE);
export const localFolder = (root: string) =>
  path.join(root, PLAN_FOLDER, LOCAL_FOLDER);

/** Creates the plan folder with its README and .gitignore, or completes one that exists. */
export function preparePlanFolder(root: string) {
  const folder = planFolder(root);
  fs.mkdirSync(folder, { recursive: true });
  const readme = path.join(folder, "README.txt");
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  const ignore = path.join(folder, ".gitignore");
  const lines = fs.existsSync(ignore)
    ? fs.readFileSync(ignore, "utf8").split(/\r?\n/)
    : [];
  if (!lines.includes(IGNORED))
    fs.writeFileSync(ignore, [...lines.filter(Boolean), IGNORED].join("\n") + "\n");
}

/**
 * Writes a file so that a reader sees either the old content or the new,
 * never part of each: the new content goes to a temporary file in the same
 * folder, which then takes the file's name.
 */
export function writeFileAtomically(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, text, { flag: "wx" });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** A file's size and modification time, which change whenever its content does. */
export function fileStamp(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PlanError } from "../domain/plan.ts";
import { LocalFiles } from "./local-files.ts";
import {
  newPlanFile,
  readPlanFile,
  writePlanFile,
  type PlanFile,
} from "./plan-file.ts";
import {
  fileStamp,
  localFolder,
  planFile,
  preparePlanFolder,
} from "./project-folder.ts";

/**
 * One project: its plan file, read once and kept in memory, and the local
 * files beside it. Every change to the plan reaches the file before it is
 * visible to anyone, and the file's revision is checked before each write, so
 * a host that writes the same folder from elsewhere shows as a conflict
 * rather than a lost update.
 */
export class Project {
  /** The project folder, as the file system names it. */
  readonly root: string;
  readonly file: string;
  readonly local: LocalFiles;
  plan: PlanFile;
  /** The plan file's stamp when it was last read or written here. */
  private stamp: string | undefined;

  private constructor(root: string, plan: PlanFile, stamp: string | undefined) {
    this.root = root;
    this.file = planFile(root);
    this.local = new LocalFiles(localFolder(root));
    this.plan = plan;
    this.stamp = stamp;
  }

  /** The project in a folder, or nothing when the folder has no plan file. */
  static open(root: string): Project | undefined {
    const file = planFile(root);
    if (!fs.existsSync(file)) return undefined;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new PlanError("DENIED", "The plan file must be a regular file");
    const project = new Project(root, readPlanFile(file), fileStamp(file));
    preparePlanFolder(root);
    return project;
  }

  /** A new plan in a folder that has none. */
  static create(
    root: string,
    title: string,
    options: { id?: string; source?: string } = {},
  ): Project {
    const file = planFile(root);
    if (fs.existsSync(file))
      throw new PlanError("BOUND", "This folder already has a plan");
    preparePlanFolder(root);
    const plan = newPlanFile(
      options.id ?? randomUUID(),
      title,
      options.source ?? randomUUID(),
    );
    writePlanFile(file, plan);
    return new Project(root, plan, fileStamp(file));
  }

  /** Reads the plan file again when it changed on disk since it was last read or written here. */
  refresh(): "current" | "updated" | "unreadable" {
    if (fileStamp(this.file) === this.stamp) return "current";
    try {
      this.plan = readPlanFile(this.file);
    } catch {
      return "unreadable";
    }
    this.stamp = fileStamp(this.file);
    return "updated";
  }

  /**
   * Makes `next` the plan: the file first, then memory. A file that changed
   * on disk meanwhile is read first; when it holds another revision, the
   * change is refused and the newer plan is kept, and when it cannot be
   * read, it is set aside and replaced.
   */
  write(next: PlanFile) {
    if (fileStamp(this.file) !== this.stamp) this.reconcile();
    writePlanFile(this.file, next);
    this.plan = next;
    this.stamp = fileStamp(this.file);
  }

  private reconcile() {
    let onDisk: PlanFile;
    try {
      onDisk = readPlanFile(this.file);
    } catch {
      const kept = `${this.file}.unreadable-${Date.now()}`;
      fs.copyFileSync(this.file, kept);
      return;
    }
    if (onDisk.revision === this.plan.revision && onDisk.id === this.plan.id) return;
    this.plan = onDisk;
    this.stamp = fileStamp(this.file);
    throw new PlanError(
      "CONFLICT",
      `The plan file changed on disk (now revision ${onDisk.revision}); it was reloaded. Read it again before retrying.`,
    );
  }
}

/** The folder's path as the file system names it, for comparing project folders. */
export const realRoot = (root: string) => fs.realpathSync(root);

/** Whether `folder` is `base` or lies inside it. */
export function within(folder: string, base: string) {
  const relative = path.relative(base, folder);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  );
}

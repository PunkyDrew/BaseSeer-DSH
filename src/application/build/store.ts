import { randomUUID } from "node:crypto";
import { PlanError } from "../../domain/plan.ts";
import type { Records } from "../records.ts";
import { BUILD_FORMAT, now, type BuildRun } from "./model.ts";

/**
 * This BaseSeer process. A build saved as running by another one lost its
 * lead and subagents when DSH restarted, so nothing will finish it.
 */
const PROCESS = randomUUID();

const RESTARTED = "DSH restarted while this build ran. The work so far stays in the project folder.";

/** Whether a saved build is in the shape this version reads. */
const readable = (row: unknown): row is BuildRun =>
  (row as Partial<BuildRun> | undefined)?.format === BUILD_FORMAT;

/**
 * Saved builds: reading and writing them, telling observers when one
 * changes, and running a build's checks one at a time.
 */
export class BuildStore {
  readonly process = PROCESS;
  private readonly records: Records;
  private readonly ended: (b: BuildRun) => void;
  private readonly listeners = new Set<(plan: string) => void>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(records: Records, ended: (b: BuildRun) => void) {
    this.records = records;
    this.ended = ended;
  }

  /** A build left running by an earlier process ends where it is first read again. */
  private current(b: BuildRun) {
    if (b.status !== "running" || b.process === PROCESS) return b;
    b.status = "stopped";
    b.endedAt = now();
    b.reason = RESTARTED;
    this.note(b, RESTARTED);
    this.save(b);
    this.ended(b);
    return b;
  }

  onChange(listener: (plan: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get(id: string): BuildRun {
    const b = this.records.store.builds.get(id);
    if (!b) throw new PlanError("UNRESOLVED", "Unknown build");
    if (!readable(b))
      throw new PlanError(
        "SCHEMA",
        "This build was made by an earlier BaseSeer version. It stays saved, but it cannot be shown.",
      );
    return this.current(b);
  }

  /** The project's latest build, unless an earlier version made it. */
  latest(plan: string): BuildRun | undefined {
    const [b] = this.records.store.builds.forPlan(plan, 1);
    return readable(b) ? this.current(b) : undefined;
  }

  /** The project's latest completed build: the one whose work the project holds as built. */
  delivered(plan: string): BuildRun | undefined {
    return this.records.store.builds
      .forPlan(plan)
      .filter(readable)
      .find((b) => b.status === "completed");
  }

  /** The project's build that is running, if any. */
  running(plan: string): BuildRun | undefined {
    return this.records.store.builds
      .forPlan(plan, 5)
      .filter(readable)
      .map((b) => this.current(b))
      .find((b) => b.status === "running");
  }

  save(b: BuildRun) {
    b.log = b.log.slice(-200);
    this.records.store.builds.save(b as any);
    for (const listener of this.listeners) {
      try {
        listener(b.plan);
      } catch {
        /* Observers cannot interrupt a build. */
      }
    }
  }

  note(b: BuildRun, text: string) {
    b.log.push({ at: now(), text });
  }

  /** Changes a saved build and saves it. */
  updateBuild(id: string, change: (b: BuildRun) => void) {
    const b = this.get(id);
    change(b);
    this.save(b);
    return b;
  }

  /** Runs fn after every earlier fn queued for the same build has finished. */
  inTurn<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.queues.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }
}

import type { ProjectMap } from "./project-map.ts";

type Pending = {
  root: string;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  again: boolean;
  waiters: (() => void)[];
};

// Keeps each plan's saved code map current by rescanning the project after
// chat turns, collected build turns and workspace opens. Scans are
// deterministic static reads: no project code runs and no model is called.
// Requests coalesce per plan.
export class MapRefresher {
  readonly projectMap: ProjectMap;
  readonly delayMs: number;
  private pending = new Map<string, Pending>();
  private stopped = false;
  private listeners = new Set<(plan: string) => void>();
  constructor(projectMap: ProjectMap, options: { delayMs?: number } = {}) {
    this.projectMap = projectMap;
    this.delayMs = options.delayMs ?? 1500;
  }
  onRefreshed(listener: (plan: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Ask for a rescan soon. Resolves after the scan that covers this request. */
  request(plan: string, root: string, delayMs = this.delayMs): Promise<void> {
    if (this.stopped) return Promise.resolve();
    let entry = this.pending.get(plan);
    if (!entry) {
      entry = { root, running: false, again: false, waiters: [] };
      this.pending.set(plan, entry);
    }
    entry.root = root;
    const settled = new Promise<void>((resolve) =>
      entry!.waiters.push(resolve),
    );
    if (entry.running) entry.again = true;
    else {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => void this.run(plan), delayMs);
      entry.timer.unref?.();
    }
    return settled;
  }
  private async run(plan: string) {
    const entry = this.pending.get(plan);
    if (!entry || this.stopped) return;
    entry.timer = undefined;
    entry.running = true;
    const waiters = entry.waiters.splice(0);
    try {
      // A scan already started by the owner or planner covers this request.
      const active = this.projectMap.jobs.get(plan);
      if (active?.status === "running") await active.done;
      else {
        const scope = this.projectMap.read(plan).latest?.scope ?? "";
        this.projectMap.start(plan, entry.root, scope);
        await this.projectMap.jobs.get(plan)?.done;
      }
      if (this.projectMap.jobs.get(plan)?.status === "complete")
        for (const listener of this.listeners) {
          try {
            listener(plan);
          } catch {
            /* Observers cannot interrupt map maintenance. */
          }
        }
    } catch {
      /* A plan no longer open, a moved folder or a busy scan leaves the last map. */
    } finally {
      entry.running = false;
      for (const resolve of waiters) resolve();
      if (entry.again && !this.stopped) {
        entry.again = false;
        entry.timer = setTimeout(() => void this.run(plan), this.delayMs);
        entry.timer.unref?.();
      } else if (!entry.waiters.length) this.pending.delete(plan);
    }
  }
  dispose() {
    this.stopped = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      for (const resolve of entry.waiters.splice(0)) resolve();
    }
    this.pending.clear();
    this.listeners.clear();
  }
}

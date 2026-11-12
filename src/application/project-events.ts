/**
 * Tells open views that a project's saved state changed: its plan, its code
 * map or its build. Views then read the current state again; an event never
 * carries the state itself.
 */
export class ProjectEvents {
  private readonly listeners = new Set<(plan: string) => void>();

  subscribe(listener: (plan: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  changed(plan: string) {
    for (const listener of this.listeners) {
      try {
        listener(plan);
      } catch {
        /* A failing view cannot stop the others from hearing the change. */
      }
    }
  }
}

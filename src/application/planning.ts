import { realpathSync } from "node:fs";
import { Store } from "../storage/store.ts";
import { PlanError, type Plan, type Role } from "../domain/plan.ts";

export interface Actor {
  id: string;
  role: Role;
  plan: string;
  workspace: string;
  /** The identity of the project's source, as its snapshots and source roots name it. */
  source: string;
}

/** Which DSH workspace works on which project: a workspace is bound to the plan in its folder. */
export class Planning {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  /**
   * Binds a workspace to the plan in its folder, reading the plan the first
   * time, or making one when the folder has none and a title is given.
   * Nothing when the folder has no plan and none is wanted.
   */
  open(workspace: string, root: string, title: string): Plan;
  open(workspace: string, root: string): Plan | undefined;
  open(workspace: string, root: string, title?: string): Plan | undefined {
    const binding = this.binding(workspace);
    if (binding) return this.store.read(binding.plan);
    const project =
      this.store.open(root) ??
      (title === undefined ? undefined : this.store.create(root, title));
    if (!project) return undefined;
    this.store.bindings.add(workspace, project.plan.id, project.root, project.plan.source);
    return this.store.read(project.plan.id);
  }
  binding(workspace: string) {
    return this.store.bindings.forWorkspace(workspace);
  }
  actor(id: string, role: Role, workspace: string, root: string): Actor {
    const b = this.binding(workspace);
    if (!b || b.root !== realpathSync(root))
      throw new PlanError(
        "UNRESOLVED",
        "Workspace/root needs an explicit binding",
      );
    return { id, role, workspace, plan: b.plan, source: b.source };
  }
}

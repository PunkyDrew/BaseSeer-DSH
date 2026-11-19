import { randomUUID } from "node:crypto";
import { PlanError, type OwnerMessage, type Plan } from "../domain/plan.ts";
import { DataFolder } from "./data-folder.ts";
import type { PlanFile } from "./plan-file.ts";
import { PlanDesign, PlanDocuments, PlanHistory, type PlanAccess } from "./plan-state.ts";
import { Project, realRoot, within } from "./project.ts";
import {
  ProjectBuilds,
  ProjectGenerations,
  ProjectMaps,
  ProjectNavigation,
  ProjectReports,
  ProjectUsage,
  SourceObservations,
} from "./project-local.ts";

export type Binding = {
  workspace: string;
  plan: string;
  root: string;
  source: string;
};

/** How many answered commands are remembered, so a retried command gets its first answer. */
const COMMANDS_REMEMBERED = 1000;

/**
 * Everything BaseSeer keeps: each project in its own folder (the plan file
 * and the local files beside it), and the little that is not about one
 * project in BaseSeer's data folder. A transaction changes one or more plans
 * and writes each changed plan file when it ends; a rehearsal runs the same
 * way and writes nothing.
 */
export class Store {
  readonly data: DataFolder;
  private readonly excludedRoots: string[];
  private readonly projects = new Map<string, Project>();
  private readonly byRoot = new Map<string, string>();
  private readonly bound = new Map<string, Binding>();
  private readonly openListeners = new Set<(project: Project) => void>();
  private readonly answered = new Map<string, { request: string; response: string }>();
  private active?: { pending: Map<Project, PlanFile>; rehearsing: boolean };

  readonly documents: PlanDocuments;
  readonly design: PlanDesign;
  readonly recordsHistory: PlanHistory;
  readonly maps: ProjectMaps;
  readonly generations: ProjectGenerations;
  readonly sources: SourceObservations;
  readonly navigation: ProjectNavigation;
  readonly usage: ProjectUsage;
  readonly builds: ProjectBuilds;
  /** The latest validation of each project's code, which /baseseer repair fixes. */
  readonly validations: ProjectReports;
  /** The latest review of each project's plan at the go, which tells the next go the plan was reviewed. */
  readonly planReviews: ProjectReports;

  constructor(dataDir: string, options: { excludedRoots?: string[] } = {}) {
    this.data = new DataFolder(dataDir);
    this.excludedRoots = options.excludedRoots ?? [];
    const access: PlanAccess = {
      view: (plan) => this.view(plan),
      edit: (plan) => this.edit(plan),
    };
    const projects = {
      project: (plan: string) => this.project(plan),
      loaded: () => this.loaded(),
    };
    this.documents = new PlanDocuments(access);
    this.design = new PlanDesign(access);
    this.recordsHistory = new PlanHistory(access);
    this.maps = new ProjectMaps(projects, {
      read: (plan) => structuredClone(this.view(plan).explanations),
      write: (plan, explanations) => this.change(plan, (state) => {
        state.explanations = structuredClone(explanations);
      }),
    });
    this.generations = new ProjectGenerations(projects);
    this.sources = new SourceObservations(projects);
    this.navigation = new ProjectNavigation(projects);
    this.usage = new ProjectUsage(projects);
    this.builds = new ProjectBuilds(projects);
    this.validations = new ProjectReports(projects, "validation.json", "validation");
    this.planReviews = new ProjectReports(projects, "plan-review.json", "plan review");
  }

  get pricing() {
    return this.data.pricing;
  }
  get sessions() {
    return this.data.sessions;
  }

  /** The acceptance check's copies of a project are never projects of their own. */
  private excluded(root: string) {
    return this.excludedRoots.some((excluded) => within(root, excluded));
  }

  /** The project in a folder, read the first time; nothing when the folder has no plan or is a check's copy. */
  open(root: string): Project | undefined {
    const real = realRoot(root);
    if (this.excluded(real)) return undefined;
    const known = this.byRoot.get(real);
    if (known) return this.projects.get(known);
    const project = Project.open(real);
    if (!project) return undefined;
    this.admit(project);
    return project;
  }

  /** A new plan for a folder that has none. */
  create(root: string, title: string, options: { id?: string; source?: string } = {}): Project {
    const real = realRoot(root);
    if (this.excluded(real))
      throw new PlanError("DENIED", "An acceptance check's copy cannot have a plan of its own");
    if (this.byRoot.has(real)) throw new PlanError("BOUND", "This folder already has a plan");
    const project = Project.create(real, title, options);
    this.admit(project);
    return project;
  }

  /**
   * Takes a project in. A copied folder arrives with the id of a plan that is
   * already open elsewhere; the copy becomes a plan of its own.
   */
  private admit(project: Project) {
    if (this.projects.has(project.plan.id))
      project.write({ ...project.plan, id: randomUUID(), source: randomUUID() });
    this.projects.set(project.plan.id, project);
    this.byRoot.set(project.root, project.plan.id);
    for (const listener of this.openListeners) listener(project);
  }

  onOpen(listener: (project: Project) => void) {
    this.openListeners.add(listener);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  project(plan: string): Project {
    const project = this.projects.get(plan);
    if (!project) throw new PlanError("UNRESOLVED", "No explicitly bound plan");
    return project;
  }
  has(plan: string) {
    return this.projects.has(plan);
  }
  loaded(): Project[] {
    return [...this.projects.values()];
  }
  read(plan: string): Plan {
    const { id, revision, title } = this.view(plan);
    return { id, revision, title };
  }
  /** Reads the plan file again when it changed on disk, as after a pull. */
  refresh(plan: string) {
    return this.project(plan).refresh();
  }

  readonly bindings = {
    forWorkspace: (workspace: string): Binding | undefined => this.bound.get(workspace),
    forRoot: (root: string): Binding | undefined =>
      [...this.bound.values()].find((b) => b.root === root),
    forPlan: (plan: string): Binding | undefined =>
      [...this.bound.values()].find((b) => b.plan === plan),
    add: (workspace: string, plan: string, root: string, source: string) => {
      this.project(plan);
      this.bound.set(workspace, { workspace, plan, root, source });
    },
    remove: (workspace: string) => {
      this.bound.delete(workspace);
    },
  };

  private view(plan: string): PlanFile {
    const project = this.project(plan);
    return this.active?.pending.get(project) ?? project.plan;
  }

  private edit(plan: string): PlanFile {
    if (!this.active)
      throw new PlanError("TRANSACTION", "Changing a plan requires a transaction");
    const project = this.project(plan);
    let pending = this.active.pending.get(project);
    if (!pending) {
      pending = { ...project.plan };
      this.active.pending.set(project, pending);
    }
    return pending;
  }

  /** Moves the plan to the next revision, once the caller's expected revision matches. */
  advance(plan: string, expected: number): Plan {
    const state = this.edit(plan);
    if (state.revision !== expected)
      throw new PlanError(
        "CONFLICT",
        `CONFLICT: expected revision ${expected}, current revision ${state.revision}. Review before retrying.`,
        { expected, current: this.read(plan) },
      );
    state.revision = expected + 1;
    return this.read(plan);
  }

  private run<T>(fn: () => T, rehearsing: boolean): T {
    if (fn.constructor.name === "AsyncFunction")
      throw new PlanError("INVALID", "Storage transactions must be synchronous");
    if (this.active) {
      if (rehearsing && !this.active.rehearsing)
        throw new PlanError("INVALID", "A rehearsal must be top-level");
      return fn();
    }
    this.active = { pending: new Map(), rehearsing };
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new PlanError("INVALID", "Storage transactions must be synchronous");
      if (!rehearsing)
        for (const [project, next] of this.active.pending) project.write(next);
      return result;
    } finally {
      this.active = undefined;
    }
  }

  /** Runs fn, then writes every plan it changed; a failure leaves every plan as it was. */
  transaction<T>(fn: () => T): T {
    return this.run(fn, false);
  }

  /** Runs fn exactly as a transaction would, and keeps none of it: a preview. */
  rehearse<T>(fn: () => T): T {
    return this.run(fn, true);
  }

  /** Changes one plan: within the transaction in progress, else in one of its own. */
  change(plan: string, fn: (state: PlanFile) => void) {
    this.transaction(() => fn(this.edit(plan)));
  }

  /**
   * What the owner wrote in the project's Planning chats, oldest first.
   * Keeping a message leaves the plan's revision as it is: the planner's
   * next write still expects the revision it read.
   */
  readonly ownerMessages = {
    read: (plan: string): OwnerMessage[] => structuredClone(this.view(plan).ownerMessages),
    keep: (plan: string, message: OwnerMessage) =>
      this.change(plan, (state) => {
        state.ownerMessages = [...state.ownerMessages, message];
      }),
  };

  /**
   * Runs a command once for its identity: a retry with the same request gets
   * the first answer, and a different request under a used identity is
   * refused. A rehearsal's commands are not remembered.
   */
  command<T>(actor: string, key: string, request: unknown, fn: () => T): T {
    const identity = `${actor}\n${key}`;
    const encoded = JSON.stringify(request);
    const earlier = this.answered.get(identity);
    if (earlier) {
      if (earlier.request !== encoded)
        throw new PlanError("IDEMPOTENCY", "Command identity was reused for a different request");
      return JSON.parse(earlier.response) as T;
    }
    const result = this.transaction(fn);
    // Inside a rehearsal the transaction joins it, so `active` still says so here.
    if (!this.active?.rehearsing) {
      this.answered.set(identity, { request: encoded, response: JSON.stringify(result) });
      if (this.answered.size > COMMANDS_REMEMBERED)
        this.answered.delete(this.answered.keys().next().value!);
    }
    return result;
  }

  close() {
    this.projects.clear();
    this.byRoot.clear();
    this.bound.clear();
    this.openListeners.clear();
    this.answered.clear();
  }
}

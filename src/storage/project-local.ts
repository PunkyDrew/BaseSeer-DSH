import {
  validateProjectMap,
  type ProjectSnapshot,
  type SavedMap,
  type SourceExplanation,
} from "../contracts/project-map.ts";
import type { Generation } from "../contracts/generation.ts";
import type { ModelUsage } from "../domain/model-usage.ts";
import { navigation } from "../domain/navigation.ts";
import { canonical } from "../domain/records.ts";
import { PlanError } from "../domain/plan.ts";
import { arrayValue, objectValue } from "./json.ts";
import type { Project } from "./project.ts";

// This machine's record of a project, kept in files under .baseseer/local:
// the code map, generation runs, source observations, the views' state,
// usage receipts, build records, and the latest validation of the code and
// review of the plan. Each
// part reads and writes its own file.

/** The projects this store has open, and the one a plan belongs to. */
export interface Projects {
  project(plan: string): Project;
  loaded(): Project[];
}

const MAP_FILE = "map.json";
const GENERATIONS_FILE = "generations.json";
const UI_STATE_FILE = "ui-state.json";
const USAGE_LOG = "usage.jsonl";
const BUILDS_FOLDER = "builds";
const OBSERVATIONS_FOLDER = "observations";
/** Generation runs kept per project; older ones are of no further use. */
const GENERATIONS_KEPT = 50;

type Snapshots = { baseline: ProjectSnapshot | null; latest: ProjectSnapshot | null };

function snapshots(input: unknown): Snapshots {
  const value = objectValue(input);
  const map = validateProjectMap({
    baseline: value.baseline ?? null,
    latest: value.latest ?? null,
    explanations: [],
  });
  return { baseline: map.baseline, latest: map.latest };
}

/**
 * The code map: the scans in this machine's cache, and the planner's
 * explanations, which live in the plan file since the plan's records cite
 * them.
 */
export class ProjectMaps {
  private readonly projects: Projects;
  private readonly explanations: {
    read(plan: string): SourceExplanation[];
    write(plan: string, value: SourceExplanation[]): void;
  };
  constructor(projects: Projects, explanations: ProjectMaps["explanations"]) {
    this.projects = projects;
    this.explanations = explanations;
  }
  has(plan: string): boolean {
    return this.projects.project(plan).local.read(MAP_FILE, "code map", snapshots) !== undefined;
  }
  read(plan: string): SavedMap | undefined {
    const saved = this.projects.project(plan).local.read(MAP_FILE, "code map", snapshots);
    const explanations = this.explanations.read(plan);
    if (!saved && !explanations.length) return undefined;
    return {
      baseline: saved?.baseline ?? null,
      latest: saved?.latest ?? null,
      explanations,
    };
  }
  save(plan: string, map: SavedMap) {
    validateProjectMap(map);
    const project = this.projects.project(plan);
    project.local.write(MAP_FILE, { baseline: map.baseline, latest: map.latest });
    if (canonical(map.explanations) !== canonical(this.explanations.read(plan)))
      this.explanations.write(plan, map.explanations);
  }
}

function generation(input: unknown): Generation {
  const g = objectValue(input);
  if (
    ["id", "key", "plan", "session", "scope", "startedAt"].some(
      (k) => typeof g[k] !== "string",
    ) ||
    ![
      "scanning",
      "generating",
      "stopping",
      "complete",
      "needs-attention",
      "cancelled",
    ].includes(g.status)
  )
    throw Error("Invalid generation envelope");
  // An invalid assessment is found by its own validation at the application
  // boundary; the run is kept either way.
  return g as Generation;
}

const generations = (input: unknown) => arrayValue(input).map(generation);

/** The runs that mapped existing code into the plan, newest last. */
export class ProjectGenerations {
  private readonly projects: Projects;
  constructor(projects: Projects) {
    this.projects = projects;
  }
  private of(project: Project): Generation[] {
    return project.local.read(GENERATIONS_FILE, "generation runs", generations) ?? [];
  }
  all(): Generation[] {
    return this.projects.loaded().flatMap((project) => this.of(project));
  }
  latest(plan: string): Generation | undefined {
    const runs = this.of(this.projects.project(plan));
    return runs[runs.length - 1];
  }
  request(key: string): Generation | undefined {
    return this.all().find((run) => run.key === key);
  }
  save(run: Generation) {
    generation(run);
    const project = this.projects.project(run.plan);
    const others = this.of(project).filter((r) => r.id !== run.id);
    project.local.write(GENERATIONS_FILE, [...others, run].slice(-GENERATIONS_KEPT));
  }
}

export type SourceContent = { path: string; sha256: string; content: string };

function sourceContents(input: unknown): SourceContent[] {
  return arrayValue(input).map((x) => {
    const f = objectValue(x);
    if (["path", "sha256", "content"].some((k) => typeof f[k] !== "string"))
      throw Error("Invalid source contents");
    return f as SourceContent;
  });
}

/** The source files a review read, kept by the digest of the snapshot it read them in. */
export class SourceObservations {
  private readonly projects: Projects;
  constructor(projects: Projects) {
    this.projects = projects;
  }
  observe(plan: string, digest: string, contents: SourceContent[]) {
    const local = this.projects.project(plan).local;
    const name = `${OBSERVATIONS_FOLDER}/${digest}.json`;
    if (local.read(name, "source observation", sourceContents)) return;
    local.write(name, contents);
  }
  contents(plan: string, digest: string): SourceContent[] | undefined {
    return this.projects
      .project(plan)
      .local.read(`${OBSERVATIONS_FOLDER}/${digest}.json`, "source observation", sourceContents);
  }
}

export type Focus = { id: string; title: string };
type UiState = {
  navigation: Record<string, ReturnType<typeof navigation>>;
  /** The session whose navigation was saved last, which a new session starts from. */
  lastNavigation?: string;
  focus: Record<string, Focus>;
};

function focus(input: unknown): Focus {
  const value = objectValue(input);
  if (typeof value.id !== "string" || typeof value.title !== "string")
    throw Error("Invalid focus");
  return { id: value.id, title: value.title };
}

function uiState(input: unknown): UiState {
  const value = objectValue(input);
  const saved: UiState = { navigation: {}, focus: {} };
  for (const [session, nav] of Object.entries(objectValue(value.navigation ?? {})))
    saved.navigation[session] = navigation(nav);
  for (const [session, item] of Object.entries(objectValue(value.focus ?? {})))
    saved.focus[session] = focus(item);
  if (typeof value.lastNavigation === "string") saved.lastNavigation = value.lastNavigation;
  return saved;
}

/** Where each session left the views, and the record the owner has in focus. */
export class ProjectNavigation {
  private readonly projects: Projects;
  constructor(projects: Projects) {
    this.projects = projects;
  }
  // The views' state is this machine's convenience, not a record of the
  // project: one this version cannot read is dropped, and the next save
  // replaces it.
  private state(plan: string): UiState {
    const empty: UiState = { navigation: {}, focus: {} };
    try {
      return this.projects.project(plan).local.read(UI_STATE_FILE, "view state", uiState) ?? empty;
    } catch (error) {
      if (error instanceof PlanError && error.code === "CORRUPT") return empty;
      throw error;
    }
  }
  private write(plan: string, state: UiState) {
    this.projects.project(plan).local.write(UI_STATE_FILE, state);
  }
  read(plan: string, session: string): ReturnType<typeof navigation> | undefined {
    return this.state(plan).navigation[session];
  }
  latest(plan: string): ReturnType<typeof navigation> | undefined {
    const state = this.state(plan);
    return state.lastNavigation === undefined
      ? undefined
      : state.navigation[state.lastNavigation];
  }
  save(plan: string, session: string, value: ReturnType<typeof navigation>) {
    const state = this.state(plan);
    state.navigation[session] = navigation(value);
    state.lastNavigation = session;
    this.write(plan, state);
  }
  focus(plan: string, session: string): Focus | undefined {
    return this.state(plan).focus[session];
  }
  setFocus(plan: string, session: string, value: Focus) {
    const state = this.state(plan);
    state.focus[session] = focus(value);
    this.write(plan, state);
  }
  clearFocus(plan: string, session: string) {
    const state = this.state(plan);
    delete state.focus[session];
    this.write(plan, state);
  }
}

function usageRow(plan: string) {
  return (input: unknown): ModelUsage => {
    const value = objectValue(input);
    if (
      value.plan !== plan ||
      typeof value.id !== "string" ||
      typeof value.session !== "string" ||
      !Number.isSafeInteger(value.started)
    )
      throw Error("Invalid model usage identity");
    return value as ModelUsage;
  };
}

/**
 * Model requests and what they cost. A request is held in memory while it
 * runs and appended to the project's usage log once its outcome is known, so
 * the log holds one line per request; a host that dies mid-request loses
 * that request's receipt.
 */
export class ProjectUsage {
  private readonly projects: Projects;
  private readonly inFlight = new Map<string, ModelUsage>();
  /** Each request's identity as first saved, so a receipt cannot move to another plan or session. */
  private readonly identities = new Map<string, string>();
  constructor(projects: Projects) {
    this.projects = projects;
  }
  save(row: ModelUsage) {
    const identity = JSON.stringify([row.plan, row.session, row.started]);
    const known = this.identities.get(row.id);
    if (known !== undefined && known !== identity)
      throw new PlanError("DENIED", "Usage request identity changed");
    this.identities.set(row.id, identity);
    if (row.outcome === "started") {
      this.inFlight.set(row.id, structuredClone(row));
      return;
    }
    this.projects.project(row.plan).local.append(USAGE_LOG, row);
    this.inFlight.delete(row.id);
  }
  usage(plan: string): ModelUsage[] {
    const ended = this.projects.project(plan).local.lines(USAGE_LOG, "model usage", usageRow(plan));
    const running = [...this.inFlight.values()].filter((row) => row.plan === plan);
    return [...ended, ...running].sort(
      (a, b) => a.started - b.started || a.id.localeCompare(b.id),
    );
  }
}

export type BuildRow = {
  id: string;
  plan: string;
  createdAt: string;
  status: string;
  [key: string]: unknown;
};

function buildRow(input: unknown): BuildRow {
  const value = objectValue(input);
  if (["id", "plan", "createdAt", "status"].some((k) => typeof value[k] !== "string"))
    throw Error("Invalid build record");
  return value as BuildRow;
}

/** A project's builds, one file each, read once per project and kept in memory. */
export class ProjectBuilds {
  private readonly projects: Projects;
  private readonly byPlan = new Map<string, Map<string, BuildRow>>();
  private readonly planOf = new Map<string, string>();
  constructor(projects: Projects) {
    this.projects = projects;
  }
  private of(plan: string): Map<string, BuildRow> {
    const known = this.byPlan.get(plan);
    if (known) return known;
    const project = this.projects.project(plan);
    const rows = new Map<string, BuildRow>();
    for (const name of project.local.names(BUILDS_FOLDER)) {
      const row = project.local.read(`${BUILDS_FOLDER}/${name}.json`, "build record", buildRow);
      if (!row) continue;
      rows.set(row.id, row);
      this.planOf.set(row.id, plan);
    }
    this.byPlan.set(plan, rows);
    return rows;
  }
  /** Reads every open project's builds, so a build can be found by its id alone. */
  private index() {
    for (const project of this.projects.loaded()) this.of(project.plan.id);
  }
  get(id: string): BuildRow | undefined {
    if (!this.planOf.has(id)) this.index();
    const plan = this.planOf.get(id);
    const row = plan === undefined ? undefined : this.of(plan).get(id);
    return row && structuredClone(row);
  }
  forPlan(plan: string, limit = 20): BuildRow[] {
    return [...this.of(plan).values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((row) => structuredClone(row));
  }
  save(row: BuildRow) {
    buildRow(row);
    const owner = this.planOf.get(row.id);
    if (owner !== undefined && owner !== row.plan)
      throw new PlanError("DENIED", "Build identity changed");
    const project = this.projects.project(row.plan);
    project.local.write(`${BUILDS_FOLDER}/${row.id}.json`, row);
    this.of(row.plan).set(row.id, structuredClone(row));
    this.planOf.set(row.id, row.plan);
  }
}

/**
 * The numbered report of a session that read the project for its owner: a
 * validation of its code, which /baseseer repair fixes, or a review of its
 * plan at the go.
 */
export type ReportRow = { id: string; plan: string; at: string; report: string };

/**
 * The latest report of one kind for each project, in its own file: a new one
 * replaces the last, since only the latest describes the project as it is.
 */
export class ProjectReports {
  private readonly projects: Projects;
  private readonly file: string;
  private readonly label: string;
  constructor(projects: Projects, file: string, label: string) {
    this.projects = projects;
    this.file = file;
    this.label = label;
  }
  private row(input: unknown): ReportRow {
    const value = objectValue(input);
    if (["id", "plan", "at", "report"].some((k) => typeof value[k] !== "string"))
      throw Error(`Invalid ${this.label} record`);
    return value as ReportRow;
  }
  latest(plan: string): ReportRow | undefined {
    return this.projects.project(plan).local.read(this.file, this.label, (input) => this.row(input));
  }
  save(row: ReportRow) {
    this.row(row);
    this.projects.project(row.plan).local.write(this.file, row);
  }
}

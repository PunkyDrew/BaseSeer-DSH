import fs from "node:fs";
import path from "node:path";
import { snapshot } from "../../analysis/snapshot.ts";
import { CodebaseGeneration } from "../../application/codebase-generation.ts";
import { Navigation } from "../../application/navigation.ts";
import { Planning } from "../../application/planning.ts";
import { ProjectEvents } from "../../application/project-events.ts";
import { ProjectMap } from "../../application/project-map.ts";
import { Records } from "../../application/records.ts";
import { Review } from "../../application/review.ts";
import { SessionState } from "../../application/session-state.ts";
import { PlanError, object, text } from "../../domain/plan.ts";
import { MapRefresher } from "../../application/map-refresh.ts";
import { BuildRuns } from "../../application/build/index.ts";
import { buildSessions } from "./build/subagents.ts";
import { workspaceMaps } from "./workspace-maps.ts";
import { Store } from "../../storage/store.ts";
import { generationRequests } from "./generation-requests.ts";
import { modelServices } from "./models.ts";
import { plannerCapability } from "./planner-capability.ts";
import { registerPlanningCommand } from "./planning-command.ts";
import { projectRequests } from "./project-requests.ts";
import { providerPricing } from "./provider-pricing.ts";
import { modelUsageObserver } from "./model-usage.ts";
import { sessionLifecycle } from "./session-lifecycle.ts";
import { registerProjectEvents } from "./project-events.ts";
import { sessionRequests } from "./session-requests.ts";
import { buildFoldersRoot } from "./build/environment.ts";

// DSH is isolated here. Runtime version and these public interfaces are pinned by Stage 0.
export const inject = [
  "connection",
  "agents",
  "tools",
  "workspaceRegistry",
  "sessionPersistence",
  "systemPrompt",
  "commands",
  "llm",
  "sessionController",
];
export interface Config {
  dataDir?: string;
}
export function defaultDataDirectory(home: string): string {
  return path.join(home, "plugins", "baseseer");
}

export async function createIntegration(ctx: any, config: Config = {}) {
  const data =
    config.dataDir ??
    process.env.DSH_BUILD_PLAN_DATA ??
    (process.env.DSH_HOME && defaultDataDirectory(process.env.DSH_HOME));
  if (!data)
    throw new Error("BaseSeer requires DSH_HOME or an explicit dataDir");
  fs.mkdirSync(data, { recursive: true });
  // The acceptance check's copies of a project live here, or under the home
  // folder when this path resolves to another; neither is a project of its own.
  const dataBuilds = path.join(data, "builds");
  const buildsDirectory = buildFoldersRoot(dataBuilds);
  const store = new Store(data, { excludedRoots: [dataBuilds, buildsDirectory] });
  const planning = new Planning(store);
  const records = new Records(store);
  const projectMap = new ProjectMap(store);
  const generation = new CodebaseGeneration(store, projectMap);
  const pricing = providerPricing(ctx, store.pricing);
  const navigation = new Navigation(store);
  const refresher = new MapRefresher(projectMap);
  const sessions = new SessionState(store);
  const models = modelServices(ctx, records, {
    pricing,
    // Model settings wait while a build of the plan runs.
    building: (plan) => !!builds.running(plan),
  });
  const builds = new BuildRuns(records, buildsDirectory, refresher);
  const builders = buildSessions(ctx, { builds, records, models });
  builds.host = builders.host;
  const lifecycle = sessionLifecycle(ctx, planning, sessions, generation, builders);
  const {
    actors,
    definitions,
    plannerReleases,
    removePlanner,
    sessionWorkspace,
    installPlanner,
  } = lifecycle;
  const review = new Review(records);
  const events = new ProjectEvents();
  const stopUsage = modelUsageObserver(
    ctx,
    store.usage,
    actors,
    Date.now,
    builders.attribution,
  );
  builds.onChange((plan) => events.changed(plan));
  // A refreshed code map is shown in open views.
  refresher.onRefreshed((plan) => events.changed(plan));
  const maps = workspaceMaps(ctx, {
    planning,
    records,
    projectMap,
    refresher,
    builds,
    excluded: builders.owns,
    isPlanning: (agent) =>
      lifecycle.sessionMode(agent.id, "").value === "planning",
  });
  let disposed = false;
  ctx.effect(() => async () => {
    disposed = true;
    maps.dispose();
    refresher.dispose();
    generation.dispose();
    for (const job of projectMap.jobs.values()) job.abort.abort();
    stopUsage();
    store.close();
  });
  function bound(workspace: unknown) {
    const ws = ctx.workspaceRegistry.get(text(workspace, "workspace", 100));
    if (!ws) throw new PlanError("UNRESOLVED", "Unknown workspace");
    const actor = planning.actor("owner", "owner", ws.id, ws.path);
    return {
      ws,
      actor,
      get source() {
        return snapshot(ws.path, actor.source);
      },
    };
  }
  lifecycle.bind(
    plannerCapability({
      ctx,
      planning,
      records,
      projectMap,
      refresher,
      builds,
      sessions,
      review,
      models,
      actors,
      definitions,
      plannerReleases,
      removePlanner,
      generate: (session, command, caller) =>
        generationRequest("session-ingestion", { session, command }, caller),
    }),
  );
  const services = {
    records,
    planning,
    sessions,
    generation,
    projectMap,
    review,
    navigation,
    pricing,
    models,
    bound,
    lifecycle,
    builds,
    refresher,
  };
  registerPlanningCommand(ctx, services);
  const sessionRequest = sessionRequests(ctx, services),
    projectRequest = projectRequests(services),
    generationRequest = generationRequests(ctx, services);
  async function dispatch(endpoint: string, payload: unknown) {
    if (disposed)
      throw new PlanError("SUSPENDED", "BaseSeer host was disposed");
    const q = object(payload ?? {}, [
      "workspace",
      "key",
      "session",
      "command",
      "plan",
    ]);
    if (
      [
        "session-mode",
        "session-open-existing",
        "session-map",
        "session-ingestion",
      ].includes(endpoint)
    )
      return generationRequest(endpoint, q);
    if (endpoint.startsWith("session-") || endpoint === "provider-pricing")
      return sessionRequest(endpoint, q);
    return projectRequest(endpoint, q);
  }
  return {
    dispatch,
    store,
    planning,
    records,
    actors,
    definitions,
    installPlanner,
    bound,
    sessionWorkspace,
    events,
  };
}

export async function apply(ctx: any, config: Config = {}) {
  const integration = await createIntegration(ctx, config);
  registerApi(ctx, integration.dispatch);
  registerProjectEvents(ctx, integration.events, async (session) => {
    const ws = await integration.sessionWorkspace(session);
    return integration.bound(ws.id).actor.plan;
  });
}

export function registerApi(
  ctx: any,
  dispatch: (op: string, payload: unknown) => Promise<unknown>,
) {
  const dispose = ctx.connection.fetch.register({
    path: "/api/build-plan",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request: Request) => {
      try {
        const body = object(await request.json(), ["op", "payload"]);
        return Response.json({
          ok: true,
          value: await dispatch(text(body.op, "operation", 40), body.payload),
        });
      } catch (e) {
        const error = e as PlanError;
        return Response.json({
          ok: false,
          error: {
            code: error.code ?? "INTERNAL",
            message: error.message,
            details: error.details ?? {},
          },
        });
      }
    },
  });
  ctx.effect(() => dispose);
}

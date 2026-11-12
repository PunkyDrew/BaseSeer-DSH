import { defineTool } from "@deepseek-ai/dsh-tools";
import { PlanError, object } from "../../domain/plan.ts";
import type { Planning } from "../../application/planning.ts";
import type { Records } from "../../application/records.ts";
import type { ProjectMap } from "../../application/project-map.ts";
import type { MapRefresher } from "../../application/map-refresh.ts";
import type { BuildRuns } from "../../application/build/index.ts";
import { workspaceSummary } from "../../application/workspace-summary.ts";
import { toolJson } from "./tool-json.ts";
import type {
  NativeAgent,
  NativeSessions,
  NativeWorkspace,
  Release,
} from "./native-session.ts";

const READ_CODE = [
  "overview",
  "components",
  "connections",
  "files",
  "file",
  "source",
  "excerpt",
  "freshness",
  "status",
];

export type WorkspaceMapServices = {
  planning: Planning;
  records: Records;
  projectMap: ProjectMap;
  refresher: MapRefresher;
  builds: BuildRuns;
  /** Sessions that must not receive workspace map tools: a build's subagents, which get their own. */
  excluded(agent: NativeAgent): boolean;
  isPlanning(agent: NativeAgent): boolean;
};

/** Read the saved code map, scanning first when this plan has never been scanned. */
export async function readCode(
  s: Pick<WorkspaceMapServices, "projectMap" | "refresher">,
  plan: string,
  root: string,
  command: unknown,
  author: string,
) {
  if (!s.projectMap.read(plan).latest) await s.refresher.request(plan, root, 0);
  return s.projectMap.query(plan, root, command, author);
}

// Every chat opened in a workspace sees the current plan map and code map.
// Normal chats keep all their DSH tools and also get read-only plan_map.
// After each chat turn the code map is rescanned, so later chats start current.
export function workspaceMaps(
  ctx: NativeSessions & { workspaceRegistry: any },
  s: WorkspaceMapServices,
) {
  const installed = new Map<string, Release[]>();
  const summaries = new Map<string, { key: string; text: string }>();
  const workspaceOf = (agent: NativeAgent): NativeWorkspace | undefined => {
    const cwd = agent.session.header.cwd;
    return ctx.workspaceRegistry
      .list?.()
      .find(
        (w: NativeWorkspace) =>
          w.sessionIds.includes(agent.id) || w.path === cwd,
      );
  };
  /** The plan in this workspace's folder, read again when its file changed since the last turn. */
  const bound = (ws: NativeWorkspace) => {
    try {
      const plan = s.planning.open(ws.id, ws.path);
      if (plan) s.records.store.refresh(plan.id);
      return plan?.id;
    } catch {
      return undefined;
    }
  };
  const summaryText = (plan: string) => {
    const revision = s.records.store.read(plan).revision;
    const key = `${revision}:${s.projectMap.read(plan).latest?.digest ?? ""}`;
    const cached = summaries.get(plan);
    if (cached?.key === key) return cached.text;
    const text = `BaseSeer workspace map (the shared plan and the observed code; the plan is intent, the code map is what exists):\n${JSON.stringify(
      workspaceSummary(s.records, s.projectMap, plan),
    )}`;
    summaries.set(plan, { key, text });
    return text;
  };
  function release(id: string) {
    for (const r of (installed.get(id) ?? []).reverse()) {
      try {
        r();
      } catch {
        /* Already released with the agent. */
      }
    }
    installed.delete(id);
  }
  function install(agent: NativeAgent) {
    if (installed.has(agent.id) || s.excluded(agent)) return;
    const ws = workspaceOf(agent);
    if (!ws) return;
    const plan = bound(ws);
    if (!plan) return;
    const releases: Release[] = [];
    installed.set(agent.id, releases);
    // Frozen when the chat starts: a system prefix that changed with every plan
    // edit or rescan would defeat prompt caching. Tools return current state.
    let frozen: string | undefined;
    releases.push(
      agent.ctx.systemPrompt.section({
        name: "build-plan:workspace-map",
        order: 695,
        text: () => {
          if (frozen !== undefined) return frozen;
          try {
            const live = s.planning.binding(ws.id);
            frozen = live
              ? `${summaryText(live.plan)}\nThis summary is as of the start of this chat; ${s.isPlanning(agent) ? "plan_records and plan_code" : "plan_map"} return the current plan and code.`
              : "";
          } catch {
            frozen = "";
          }
          return frozen;
        },
      }),
    );
    if (s.isPlanning(agent)) return;
    const tool = defineTool({
      name: "plan_map",
      description:
        'Read this workspace\'s BaseSeer map. The plan map is the intended design (components, interfaces, requirements, tasks, models); the code map is what actually exists in the files. Use it to find where things live and to plan changes that fit. command.action: "summary" (plan + code overview); "records" with optional ids:[...] (the plan index, or exact records); "coverage" (each planned component vs the real files: built, partial, missing files, unplanned dependencies, files outside the plan); "build" (the planned build order and the latest build); code map: "overview", "components", "connections" (optional path), "files" (optional scope, offset), "file" (path), "source" / "excerpt" (digest, path, startLine, endLine), "freshness" (digest); "refresh" rescans the files now. Read-only: plan changes happen in a BaseSeer Planning chat.',
      parameters: {
        command: {
          type: "object",
          required: true,
          additionalProperties: true,
          properties: {
            action: { type: "string" },
          },
        },
      },
      output: {
        schema: { type: "json" },
        render: (_a: any, v: any) => [
          { type: "text", text: JSON.stringify(v) },
        ],
      },
      async execute(args: any, exec: any) {
        if (exec.agent !== agent)
          throw new PlanError("DENIED", "Wrong calling scope");
        const live = s.planning.binding(ws.id);
        if (!live)
          throw new PlanError(
            "UNRESOLVED",
            "This workspace has no BaseSeer plan yet",
          );
        const command = args.command ?? { action: "summary" };
        const action = String(command.action ?? "summary");
        let value: unknown;
        if (action === "summary")
          value = workspaceSummary(s.records, s.projectMap, live.plan);
        else if (action === "records") {
          const q = object(command, ["action", "ids"]);
          const doc = s.records.doc(live.plan);
          if (Array.isArray(q.ids)) {
            const wanted = new Set(q.ids.map(String));
            value = {
              records: doc.records.filter((r) => wanted.has(r.id)),
              links: doc.links.filter(
                (l) => wanted.has(l.from) || wanted.has(l.to),
              ),
            };
          } else
            value = {
              records: doc.records.map((r) => ({
                id: r.id,
                kind: r.kind,
                title: r.title,
                status: r.status,
              })),
              links: doc.links.map((l) => ({
                kind: l.kind,
                from: l.from,
                to: l.to,
              })),
            };
        } else if (action === "coverage")
          value = await readCode(
            s,
            live.plan,
            ws.path,
            { action: "coverage" },
            `reader:${agent.id}`,
          );
        else if (action === "build") value = s.builds.overview(live.plan);
        else if (action === "refresh") {
          await s.refresher.request(live.plan, ws.path, 0);
          value = await readCode(
            s,
            live.plan,
            ws.path,
            { action: "overview" },
            `reader:${agent.id}`,
          );
        } else if (READ_CODE.includes(action))
          value = await readCode(
            s,
            live.plan,
            ws.path,
            command,
            `reader:${agent.id}`,
          );
        else
          throw new PlanError("DENIED", `Unknown plan_map action: ${action}`);
        return toolJson(value, "plan_map");
      },
    });
    releases.push(agent.ctx.tools.register(tool));
  }
  const offs: Release[] = [];
  offs.push(
    ctx.on("agent/created", ({ agent }) => {
      try {
        install(agent);
      } catch {
        /* A missing map never blocks an ordinary chat. */
      }
    }),
  );
  offs.push(ctx.on("agent/disposed", ({ agent }) => release(agent.id)));
  offs.push(
    ctx.on("session/event", (session, event: any) => {
      const agent = ctx.agents.get(session.id);
      if (!agent) return;
      if (event?.type === "agent-preset/selected") {
        // A chat switching into Planning gets the planner tools instead.
        release(agent.id);
        install(agent);
        return;
      }
      if (event?.type !== "turn/end" || s.excluded(agent)) return;
      const ws = workspaceOf(agent);
      const binding = ws && s.planning.binding(ws.id);
      if (binding) void s.refresher.request(binding.plan, ws!.path);
    }),
  );
  return {
    /** For hosts that create agents before this module loads. */
    install,
    dispose() {
      for (const off of offs) off();
      for (const id of [...installed.keys()]) release(id);
    },
  };
}

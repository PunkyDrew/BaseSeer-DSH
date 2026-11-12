import type { Actor, Planning } from "../../application/planning.ts";
import type { SessionState } from "../../application/session-state.ts";
import type { CodebaseGeneration } from "../../application/codebase-generation.ts";
import { PlanError } from "../../domain/plan.ts";
import type {
  NativeSessions,
  NativeAgentPresets,
  NativeSessionProjections,
  NativeWorkspace,
  NativeAgent,
  NativeAgentContext,
  NativeTool,
  Release,
} from "./native-session.ts";

/** The sessions of builds and validations, which are neither planners nor ordinary chats of their project. */
export interface ChatBuilds {
  /** Makes a session a build's lead or a session it started; true when it is one, or a validation's. */
  claim(agent: NativeAgent): boolean;
}

export function sessionLifecycle(
  ctx: NativeSessions,
  planning: Planning,
  sessions: SessionState,
  generation: CodebaseGeneration,
  builds?: ChatBuilds,
) {
  const actors = new Map<string, Actor>(),
    definitions = new Map<string, Map<string, NativeTool>>();
  const plannerReleases = new Map<string, Release[]>();
  const admissionTitles = new Map<string, string>();
  let installer:
    | ((
        ws: NativeWorkspace,
        scope: NativeAgentContext,
        agent: NativeAgent,
      ) => void)
    | undefined;
  function installPlanner(
    ws: NativeWorkspace,
    scope: NativeAgentContext,
    agent: NativeAgent,
  ) {
    if (!installer)
      throw new PlanError(
        "UNAVAILABLE",
        "Planner capability is not initialized",
      );
    installer(ws, scope, agent);
  }
  function removePlanner(id: string) {
    definitions.delete(id);
    actors.delete(id);
    const failures: unknown[] = [];
    for (const release of [...(plannerReleases.get(id) ?? [])].reverse()) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Planner resources could not all be released; capability remains unavailable",
      );
    plannerReleases.delete(id);
    definitions.delete(id);
    actors.delete(id);
  }
  function presetOf(agent: NativeAgent | undefined) {
    if (!agent) return undefined;
    try {
      const service = ctx.get?.("agentPresets") as
        | NativeAgentPresets
        | undefined;
      if (!service) return undefined;
      return (
        service.composedPreset(agent.ctx) ??
        (
          ctx.get?.("sessionProjections") as
            | NativeSessionProjections
            | undefined
        )?.stateOf(agent.session, "agentPreset")
      );
    } catch {
      return undefined;
    }
  }
  function sessionMode(session: string, workspace: string) {
    const binding = planning.binding(workspace);
    const run = binding && generation.latest(binding.plan);
    const generating =
      run &&
      run.session === session &&
      ["scanning", "generating", "stopping"].includes(run.status);
    const busy = ctx.agents.get(session)?.status === "running";
    const selected = presetOf(ctx.agents.get(session)) === "baseseer-planning";
    return {
      value: selected ? "planning" : "normal",
      locked: !!(generating || busy),
      reason: generating
        ? "Stop generation before changing this chat's mode."
        : busy
          ? "Wait for this response to finish before changing mode."
          : "",
    };
  }
  async function chooseMode(
    ws: NativeWorkspace,
    agent: NativeAgent,
    mode: string,
    title?: string,
  ) {
    if (ctx.agents.get(agent.id) !== agent)
      throw new PlanError(
        "DENIED",
        "Chat identity changed before mode admission",
      );
    if (!["normal", "planning"].includes(mode))
      throw new PlanError(
        "INVALID",
        "Choose Normal or Planning for this chat.",
      );
    const state = sessionMode(agent.id, ws.id);
    if (state.locked) throw new PlanError("BUSY", state.reason);
    let service: NativeAgentPresets | undefined;
    try {
      service = ctx.get?.("agentPresets") as NativeAgentPresets | undefined;
    } catch {
      throw new PlanError(
        "UNAVAILABLE",
        "Agent presets are unavailable. Enable the preset service and start a new chat.",
      );
    }
    if (!service)
      throw new PlanError(
        "UNAVAILABLE",
        "Agent presets are unavailable. Enable the preset service and start a new chat.",
      );
    const target = mode === "planning" ? "baseseer-planning" : "standard";
    if (mode === "normal" && state.value === "normal") return state;
    const admit = () => {
      if (mode === "planning") {
        planning.open(ws.id, ws.path, title || ws.title || "Project plan");
        sessions.enroll(agent.id, ws.id);
        installPlanner(ws, agent.ctx, agent);
      } else {
        removePlanner(agent.id);
        sessions.unenroll(agent.id);
      }
    };
    if (presetOf(agent) !== target) {
      let boundary:
        | { openTurnStartSeq: number | null; lastTurn: number }
        | undefined;
      try {
        boundary = (
          ctx.get?.("sessionProjections") as
            | NativeSessionProjections
            | undefined
        )?.stateOf(agent.session, "turnBoundary") as typeof boundary;
      } catch {
        throw new PlanError(
          "UNAVAILABLE",
          "Session projections are unavailable. Start a new chat when the projection service is available.",
        );
      }
      if (
        boundary &&
        (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)
      )
        throw new PlanError(
          "DENIED",
          "This chat has already started. Start a new chat and choose Planning or Standard in the mode picker.",
        );
      try {
        await service.resolve(target);
      } catch (error) {
        if ((error as { code?: string }).code !== "agent-preset/not-found")
          throw error;
        throw new PlanError(
          "UNAVAILABLE",
          `The ${target} agent preset is not installed. Install it, then select it in a new chat.`,
        );
      }
      if (title) admissionTitles.set(agent.id, title);
      const previous = presetOf(agent);
      const priorPreset = typeof previous === "string" ? previous : "standard";
      try {
        await service.select(agent, target);
        admit();
        return sessionMode(agent.id, ws.id);
      } catch (error) {
        // Native selection is persisted before enrollment listeners run. A
        // rejected source binding must not leave the chat claiming Planning.
        if (mode === "planning") {
          removePlanner(agent.id);
          sessions.unenroll(agent.id);
        }
        if (ctx.agents.get(agent.id) === agent && presetOf(agent) === target) {
          try {
            await service.select(agent, priorPreset);
          } catch {
            throw new PlanError(
              "UNAVAILABLE",
              "Mode admission failed and the prior preset could not be restored. Start a new chat; no planning capability was granted.",
            );
          }
        }
        throw error;
      } finally {
        admissionTitles.delete(agent.id);
      }
    }
    admit();
    return sessionMode(agent.id, ws.id);
  }
  async function sessionWorkspace(session: string) {
    const header =
      ctx.agents.get(session)?.session.header ??
      (await ctx.sessionPersistence.stat(session))?.header;
    if (!header?.cwd)
      throw new PlanError(
        "UNRESOLVED",
        "This session has no project directory",
      );
    const ws = await ctx.workspaceRegistry.resolveByPath(header.cwd);
    if (!ws || !ws.sessionIds.includes(session))
      throw new PlanError(
        "UNRESOLVED",
        "This session is not attached to a DSH workspace",
      );
    return ws;
  }

  function bind(install: NonNullable<typeof installer>) {
    installer = install;
    // Share the host with ordinary DSH sessions. A Planning chat has its
    // preset's tools under the chat's own permissions; the plan tools fail
    // closed when their capability has not been installed or has been revoked.
    ctx.tools.guard((exec) => {
      const agent = exec.agent;
      if (!agent || ctx.agents.get(agent.id) !== agent)
        return "BaseSeer: unknown calling agent";
      const own = definitions.get(agent.id)?.get(exec.name);
      if (!own) return;
      const actor = actors.get(agent.id);
      if (!actor)
        return "BaseSeer: Planning tools are unavailable in this chat. Select the agent preset in a new chat.";
      try {
        const ws = ctx.workspaceRegistry.get(actor.workspace);
        if (!ws) return "BaseSeer: unresolved workspace";
        planning.actor(actor.id, actor.role, actor.workspace, ws.path);
      } catch {
        return "BaseSeer: unresolved source binding";
      }
      if (ctx.tools.get(exec.name, agent) !== own)
        return "BaseSeer: operation denied by planning capability";
    });
    function syncPlanning(agent: NativeAgent) {
      if (presetOf(agent) !== "baseseer-planning") {
        if (actors.has(agent.id) || plannerReleases.has(agent.id))
          removePlanner(agent.id);
        return;
      }
      if (actors.has(agent.id)) return;
      const saved = sessions.selected(agent.id);
      const cwd = agent.session.header.cwd;
      const ws = saved
        ? ctx.workspaceRegistry.get(saved.workspace)
        : ctx.workspaceRegistry
            .list?.()
            .find(
              (workspace) =>
                workspace.sessionIds.includes(agent.id) ||
                workspace.path === cwd,
            );
      if (!ws) return;
      planning.open(
        ws.id,
        ws.path,
        admissionTitles.get(agent.id) || ws.title || "Project plan",
      );
      sessions.enroll(agent.id, ws.id);
      installPlanner(ws, agent.ctx, agent);
    }
    ctx.on("session/event", (session, event) => {
      if ((event as { type?: string })?.type !== "agent-preset/selected")
        return;
      const agent = ctx.agents.get(session.id);
      if (agent) syncPlanning(agent);
    });
    ctx.on("agent/created", ({ agent }) => {
      // Enroll before creation completes so the first model request contains
      // the current planning context.
      if (builds?.claim(agent)) return;
      agent.ctx.systemPrompt.section({
        name: "build-plan:mode",
        order: 699,
        text: () =>
          presetOf(agent) === "baseseer-planning"
            ? "BaseSeer chat mode: Planning. Keep the shared plan current as the owner talks through ideas. When the owner asks to map this codebase or build the plan from existing code, call plan_code with command:{action:'generate',scope?:'relative folder'} and continue with the returned instructions in this turn. If the plan is empty and the workspace has code, you may offer to map it. Your other DSH tools run under this chat's permissions. You never write project code or start a build yourself: the owner starts a build by typing /baseseer build, and a lead session builds it."
            : "BaseSeer chat mode: Normal. Use the available DSH tools under the existing DSH permissions. When this workspace has a BaseSeer plan, plan_map reads the plan map and the code map so you can find where things live and fit changes to the design; the code map refreshes after each turn. The owner can choose Planning in the mode picker for a new chat to change the plan.",
      });
      syncPlanning(agent);
    });
    ctx.on("agent/disposed", ({ agent }) => {
      actors.delete(agent.id);
      definitions.delete(agent.id);
      plannerReleases.delete(agent.id);
    });
  }
  return {
    actors,
    definitions,
    plannerReleases,
    installPlanner,
    removePlanner,
    sessionMode,
    chooseMode,
    sessionWorkspace,
    bind,
  };
}
export type SessionLifecycle = ReturnType<typeof sessionLifecycle>;

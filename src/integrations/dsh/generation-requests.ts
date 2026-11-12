import { randomUUID } from "node:crypto";
import { PlanError, object, text } from "../../domain/plan.ts";
import { promptCodebaseGeneration } from "./codebase-generation.ts";

import type { RequestPayload, RequestServices } from "./request-services.ts";

export function generationRequests(
  ctx: import("./native-session.ts").NativeSessions,
  services: RequestServices,
) {
  const {
    records,
    planning,
    generation,
    projectMap,
    bound,
    lifecycle,
  } = services;
  const { sessionWorkspace, sessionMode, chooseMode } = lifecycle;
  const dispatch = async (
    endpoint: string,
    q: RequestPayload,
    caller?: import("./native-session.ts").NativeAgent,
  ): Promise<unknown> => {
    switch (endpoint) {
      case "session-mode": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session);
        if (!q.command) return sessionMode(session, ws.id);
        const command = object(q.command, ["mode"]),
          mode = text(command.mode, "chat mode", 20);
        if (!["normal", "planning"].includes(mode))
          throw new PlanError(
            "INVALID",
            "Choose Normal or Planning for this chat.",
          );
        const state = sessionMode(session, ws.id);
        if (state.locked) throw new PlanError("BUSY", state.reason);
        const resolved = await ctx.sessionController.resolveAgent(session);
        if (resolved.error) throw resolved.error;
        return resolved.agent.runMaintenance(async () =>
          chooseMode(ws, resolved.agent, mode),
        );
      }
      case "session-open-existing": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session),
          agent = ctx.agents.get(session);
        if (agent?.status === "running")
          throw new PlanError(
            "BUSY",
            "Wait for this chat's current response before enabling project mapping.",
          );
        const plan = planning.open(ws.id, ws.path, ws.title || "Existing project");
        projectMap.enroll(plan.id);
        return { plan: records.read(plan.id), projectMap: true };
      }
      case "session-map": {
        const ws = await sessionWorkspace(text(q.session, "session", 100)),
          { actor } = bound(ws.id);
        if (!projectMap.has(actor.plan))
          throw new PlanError(
            "UNRESOLVED",
            "Open this existing project in BaseSeer first.",
          );
        return projectMap.query(actor.plan, ws.path, q.command);
      }
      case "session-ingestion": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session),
          command = object(q.command ?? { action: "status" }, [
            "action",
            "scope",
            "key",
            "id",
          ]),
          binding = planning.binding(ws.id);
        if (command.action === "status")
          return binding ? generation.status(binding.plan) : null;
        if (command.action === "cancel") {
          const { actor } = bound(ws.id);
          return generation.cancel(
            actor.plan,
            session,
            text(command.id, "generation", 100),
            async () => {
              await ctx.sessionController.cancel({ sessionId: session });
            },
          );
        }
        if (command.action !== "start")
          throw new PlanError("DENIED", "Unknown codebase generation action");
        if (caller && (caller.id !== session || ctx.agents.get(session) !== caller))
          throw new PlanError("DENIED", "Wrong calling scope");
        if (sessionMode(session, ws.id).value !== "planning")
          throw new PlanError("DENIED", "Select Planning in a new chat before generating BaseSeer.");
        if (binding) {
          bound(ws.id);
          const current = generation.latest(binding.plan);
          if (
            current &&
            ["scanning", "generating", "stopping"].includes(current.status)
          ) {
            if (current.session !== session)
              throw new PlanError(
                "BUSY",
                "This project is already being mapped in another chat.",
              );
            return current;
          }
        }
        const resolved = await ctx.sessionController.resolveAgent(session);
        if (resolved.error) throw resolved.error;
        const agent = resolved.agent;
        if (caller && agent !== caller) throw new PlanError("DENIED", "Calling agent changed before generation admission.");
        if (agent.status === "running" && !caller)
          throw new PlanError(
            "BUSY",
            "Wait for this chat's response before generating the plan.",
          );
        const key = caller && command.key === undefined ? `planner:${randomUUID()}` : text(command.key, "request key", 100);
        const plan = planning.open(ws.id, ws.path, ws.title || "Existing project");
        projectMap.enroll(plan.id);
        const { actor } = bound(ws.id);
        let ready!: (value: unknown) => void;
        const instructions = new Promise<unknown>((resolve) => { ready = resolve; });
        const run = generation.start(
          {
            plan: actor.plan,
            session,
            root: ws.path,
            scope:
              command.scope === undefined
                ? (projectMap.read(actor.plan).latest?.scope ?? "")
                : text(command.scope, "scan folder", 200),
            key,
          },
          async (run, prompt, allowed) => {
            if (!caller) return promptCodebaseGeneration(ctx, agent, run.id, prompt, allowed);
            if (!allowed() || ctx.agents.get(session) !== caller || sessionMode(session, ws.id).value !== "planning")
              throw new PlanError("DENIED", "Planning authority changed during scanning.");
            let failure: unknown;
            let ended: string | undefined;
            const unlisten = ctx.on("session/event", (current, event: any) => {
              if (current.id === session && event?.type === "turn/end" && ended === undefined) ended = event.data?.reason?.kind;
            });
            const release = agent.ctx.on("agent/error", ({ error }) => { failure = error; });
            try {
              ready({ generation: run, instructions: prompt, instruction: "Continue this request in the current turn using these instructions. Do not start another generation or claim completion before saving records." });
              await agent.whenIdle();
              if (failure) throw failure;
              if (ended !== "completed") throw new PlanError("INCOMPLETE", `Generation turn did not complete (${ended ?? "unknown"}). Saved records are retained.`);
            } finally { release(); unlisten(); }
          },
        );
        if (!caller) return run;
        return Promise.race([
          instructions,
          (generation.pending.get(run.id) ?? Promise.resolve()).then(() => ({ generation: generation.status(actor.plan), instruction: "Read the generation status; no new instructions are available. Do not claim generation succeeded unless its saved status establishes that." })),
        ]);
      }

      default:
        throw new PlanError("DENIED", "Unknown owner operation");
    }
  };
  return dispatch;
}

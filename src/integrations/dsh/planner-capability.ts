import {
  defineTool,
  type DefineToolOptions,
  type ParameterSchemaSpec,
} from "@deepseek-ai/dsh-tools";
import { inspectSource } from "../../analysis/source.ts";
import { type Actor } from "../../application/planning.ts";
import { PlanError, object, text } from "../../domain/plan.ts";
import { queryCommand, recordCommand } from "./command-schema.ts";
import { plannerInstructions } from "./planner-prompt.ts";
import { readPlannerGuidance } from "./planner-guidance.ts";
import { executeRecordTool } from "./record-receipt.ts";
import { readCode } from "./workspace-maps.ts";
import { ownerReader } from "./owner-words.ts";

import type { MapRefresher } from "../../application/map-refresh.ts";
import type { BuildRuns } from "../../application/build/index.ts";
import { toolJson } from "./tool-json.ts";
import { plannerArgumentFeedback } from "./planner-argument-feedback.ts";
import {
  plannerRecordQuery,
  plannerRecordContext,
} from "./planner-record-context.ts";

import type {
  NativeAgent,
  NativeAgentContext,
  NativeTool,
  NativeWorkspace,
  Release,
} from "./native-session.ts";
import type { RequestServices } from "./request-services.ts";

// Normalize every successful branch before DSH validates its output, including
// committed-write receipts. Domain objects retain their optional properties.
function definePlannerTool<const S extends ParameterSchemaSpec>(
  options: Omit<DefineToolOptions<S, { type: "json" }>, "execute"> & {
    execute(
      ...args: Parameters<DefineToolOptions<S, { type: "json" }>["execute"]>
    ): Promise<unknown>;
  },
) {
  return defineTool<S, { type: "json" }>({
    ...options,
    async execute(args, exec) {
      const value = await options.execute(args, exec);
      return toolJson(value, options.name);
    },
  });
}

export interface PlannerServices
  extends Pick<
    RequestServices,
    | "planning"
    | "records"
    | "projectMap"
    | "sessions"
    | "review"
    | "models"
  > {
  generate(
    session: string,
    command: unknown,
    caller: NativeAgent,
  ): Promise<unknown>;
  refresher: MapRefresher;
  builds: BuildRuns;
  actors: Map<string, Actor>;
  definitions: Map<string, Map<string, NativeTool>>;
  plannerReleases: Map<string, Release[]>;
  removePlanner(id: string): void;
  ctx: {
    workspaceRegistry: { get(id: string): NativeWorkspace | undefined };
  };
}

export function plannerCapability(services: PlannerServices) {
  const {
    ctx,
    planning,
    records,
    sessions,
    review,
    models,
    actors,
    definitions,
    plannerReleases,
    removePlanner,
  } = services;
  function installPlanner(
    ws: NativeWorkspace,
    agentCtx: NativeAgentContext,
    agent: NativeAgent,
  ) {
    const id = agent.id,
      workspace = ws.id;
    if (actors.has(id)) {
      Object.assign(
        actors.get(id)!,
        planning.actor(id, "planner", ws.id, ws.path),
      );
      return;
    }
    if (agent.session.header.cwd !== ws.path)
      throw new PlanError(
        "DENIED",
        "Session source root differs from the requested workspace",
      );
    const actor = planning.actor(id, "planner", workspace, ws.path);
    const releases: (() => void)[] = [];
    plannerReleases.set(id, releases);
    try {
      const ownerWords = ownerReader();
      releases.push(
        agentCtx.on("session/event", (session, event) => {
          if (session.id !== id) return;
          const words = ownerWords(event);
          if (words) records.store.ownerMessages.keep(actor.plan, words);
        }),
      );
      releases.push(plannerArgumentFeedback(agent, agentCtx));
      const read = definePlannerTool({
        name: "plan_source",
        description:
          "Read source or list one directory using paths relative to the project root. No outside-project, hidden, dependency or build folders; no execution.",
        parameters: {
          path: {
            type: "string",
            required: true,
            description:
              "Path relative to the project root; empty or . lists root. No outside-project, hidden, dependency or build paths.",
          },
          query: {
            type: "string",
            description: "Optional literal query for read mode.",
          },
          mode: {
            type: "string",
            description:
              "read (default): bounded source contents and optional literal query; list: one directory's entries.",
          },
        },
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          return inspectSource(ws.path, args);
        },
      });
      const structured = definePlannerTool({
        name: "plan_records",
        description:
          'Read or update the shared plan using a command object. Call {"command":{"op":"read"}} for a concise record index; add ids:[...] for exact records, which come back whole, or section:"full" for complete retained plan/history. Paged responses provide nextOffset and sha256; repeat the same command with both values until complete. To save, use {"command":{"op":"put","expected":<revision>,"key":"<unique key>","record":<record>}} or op:"batch" with records, links and removes:[ids] (the questions an answer settles, with the change it makes or alone). The top-level argument is command, never arguments; do not JSON-stringify either object. Follow the planning instructions in system context. A write that fails validation saves nothing and names every field at fault; correct them all and save again. A saved plan never grants implementation authority.',
        parameters: { command: recordCommand },
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          const current = ctx.workspaceRegistry.get(workspace);
          if (!current)
            throw new PlanError(
              "UNRESOLVED",
              "Workspace registration was removed",
            );
          planning.actor(id, "planner", workspace, current.path);
          const query = plannerRecordQuery(args.command);
          const mutates = !["read", "schema", "preview"].includes(String(args.command?.op));
          let committed = false;
          try {
            const result = executeRecordTool(records, actor, query.command);
            committed = mutates;
            return plannerRecordContext(
              {
                ...result,
                receipt: {
                  operation: args.command?.op,
                  changeCommitted: committed,
                  revision: result.revision,
                  instruction: committed
                    ? "All supplied records and relationships committed atomically. changes lists records; relationships lists saved links and the current total. Read current records if more detail is needed; do not infer missing links from the record-only changes list."
                    : args.command?.op === "preview"
                      ? "Preview only: nothing was saved. Changes, versions and relationships describe the proposed result, not saved records."
                      : "Read only: this call changed nothing. Do not claim any record was added, updated or removed by this call.",
                },
              },
              query.view,
            );
          } catch (error) {
            if (committed)
              throw new PlanError(
                "INCOMPLETE",
                "The plan write was saved, but its receipt could not be prepared. Read back the current plan before retrying; do not repeat the committed write.",
              );
            if (error instanceof PlanError)
              throw new PlanError(error.code, `${error.message} This command was not saved.`, error.details);
            throw error;
          }
        },
      });
      const guidance = definePlannerTool({
        name: "plan_guide",
        description:
          "Read BaseSeer guidance only for the current decision. Omit topic for an index; use a named topic from the index or system instructions. Guidance is read-only and never grants execution. Reuse unchanged guidance.",
        parameters: {
          topic: { type: "string" },
          offset: { type: "number" },
          sha256: { type: "string" },
        },
        output: {
          schema: { type: "json" },
          render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          return readPlannerGuidance(args);
        },
      });
      const code = definePlannerTool({
        name: "plan_code",
        description:
          "Read actual workspace code independently of planned design. inspect returns bounded per-language capabilities, declarations, scopes, local imports and static relationships with source/tool provenance (TypeScript and JavaScript, HTML, CSS, Markdown and package.json); other files are read as source only. A static reference is not runtime execution. source with digest,path reads a file; excerpt with digest,path,startLine,endLine returns up to 81 numbered lines for exact citations; freshness with digest checks changes. For an opened existing project use overview first, files with optional scope and offset (100 per page), then file with path for language facts and unresolved targets. components returns source-bound responsibilities, purpose-bearing relationships, internal references and unmapped/shared-file gaps, with an explicit sourceCurrent check. Use this for the architectural overview. connections with optional path returns detailed file-level incoming/outgoing relationships across folders and gaps. generate with unique key and optional relative scope starts the shared existing-codebase plan generation and returns instructions to follow in this turn; start with optional relative scope starts only a scan; status and cancel with id manage progress. explain with explanation:{digest,title,explanation,sources:[{path,startLine,endLine,quote}],connections?:[{from,to,kind,label,detail,citations:[0,1]}]} saves inferred architecture and directed relationships. Connection kind is calls, data, configures or uses; from/to are inspected file paths and citation indexes must cover both endpoints. Imported facts are historical. Source baseline and inferences persist across sessions but never accept design or verify behavior. No project code or configuration executes; use path, not file.",
        parameters: { command: queryCommand },
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          planning.actor(id, "planner", workspace, ws.path);
          if (args.command?.action === "generate") {
            const command = object(args.command, ["action", "scope", "key"]);
            return services.generate(
              id,
              { ...command, action: "start" },
              agent,
            );
          }
          // The saved code map is scanned first when this plan has none yet.
          return readCode(
            services,
            actor.plan,
            ws.path,
            args.command,
            `planner:${id}`,
          );
        },
      });
      const investigation = definePlannerTool({
        name: "plan_review",
        description:
          'Inspect and SAVE actual source evidence, architecture rule findings, source mappings and freshness: command {action:"inspect"}. Read current comparison: {action:"read"}. Historical source: {action:"source",digest:"...",path:"..."}. Returns actual snapshot and root IDs usable in mappings; source links are assertions until inspected. No execution.',
        parameters: { command: queryCommand },
        output: {
          schema: { type: "json" },
          render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          const q = object(args.command, ["action", "digest", "path"]);
          return q.action === "inspect"
            ? review.inspectAsync(actor, ws.path)
            : q.action === "read"
              ? review.readAsync(actor, ws.path)
              : q.action === "source"
                ? review.source(
                    actor,
                    text(q.digest, "digest", 64),
                    text(q.path, "path", 200),
                  )
                : (() => {
                    throw new PlanError("DENIED", "Unknown inspection");
                  })();
        },
      });
      const modelsTool = definePlannerTool({
        name: "plan_models",
        description:
          'Read the models BaseSeer can use, in bounded pages with exact thinking IDs, reference prices and eligibility under the owner\'s model policy: {command:{action:"capabilities",provider?:"grok",model?:"exact model ID or route",offset?:0,limit?:8}}. Follow page.nextOffset; unknown filters are rejected, not ignored. {command:{action:"usage"}} returns dated API-equivalent cost and disjoint token counts by model and stage, including retries; section:"requests" returns paged receipts, with optional since/until epoch milliseconds. For paged usage, carry snapshot along with nextOffset and sha256; requests still open at that cutoff stay unknown in that snapshot. Missing usage or prices are gaps, not zero cost.',
        parameters: { command: queryCommand },
        output: {
          schema: { type: "json" },
          render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          return models.query(actor, args.command);
        },
      });
      const build = definePlannerTool({
        name: "plan_build",
        description:
          `Build the plan. {command:{action:"plan"}} returns whether it is ready, the problems that stop a build from starting (a component without its contract, files or model, a record several components write without an agreed shape, an open question) and notes, such as a decision the next build would replace; once the project has been built, also nextBuild: the records added, changed and removed since the last completed build. You never start a build: the owner starts one by typing /baseseer build in this chat, which accepts the decisions it is built from; BaseSeer then summarizes this chat and a lead session on the plan's lead model builds it with subagents, until BaseSeer's acceptance check passes, and brings you the lead's report, or its question if it stops before. {command:{action:"message",text:"..."}} puts your message in the running build's lead's conversation, such as the owner's answer to its question. {command:{action:"status"}} returns the latest build.`,
        parameters: { command: queryCommand },
        output: {
          schema: { type: "json" },
          render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }],
        },
        async execute(args: any, exec: any) {
          if (exec.agent !== agent)
            throw new PlanError("DENIED", "Wrong calling scope");
          planning.actor(id, "planner", workspace, ws.path);
          const q = object(args.command ?? { action: "plan" }, ["action", "text"]);
          if (q.action === "message") return services.builds.message(actor, text(q.text, "text", 20_000));
          const overview = services.builds.overview(actor.plan);
          if (q.action === "plan")
            return {
              revision: overview.revision,
              ...overview.plan,
              nextBuild: overview.change,
            };
          if (q.action === "status") return overview.build;
          throw new PlanError("DENIED", "Use action plan, message or status; the owner starts a build with /baseseer build");
        },
      });
      actors.set(id, actor);
      definitions.set(
        id,
        new Map([
          ["plan_source", read],
          ["plan_records", structured],
          ["plan_code", code],
          ["plan_review", investigation],
          ["plan_models", modelsTool],
          ["plan_build", build],
          ["plan_guide", guidance],
        ]),
      );
      releases.push(agentCtx.tools.register(build));
      releases.push(agentCtx.tools.register(read));
      releases.push(agentCtx.tools.register(structured));
      releases.push(agentCtx.tools.register(code));
      releases.push(agentCtx.tools.register(investigation));
      releases.push(agentCtx.tools.register(modelsTool));
      releases.push(agentCtx.tools.register(guidance));
      releases.push(
        agentCtx.systemPrompt.section({
          name: "build-plan:instructions",
          order: 690,
          text: () => plannerInstructions,
        }),
      );
      releases.push(
        agentCtx.systemPrompt.section({
          name: "build-plan:context",
          order: 700,
          text: () =>
            JSON.stringify({
              actor,
              existingProject:
                "plan_code overview, components and coverage show the code that actually exists and how it compares with the plan. Source observations are not accepted design; keep inferences and future proposals separate.",
              focusedRecord: sessions.focus(actor.plan, id) ?? null,
              plan: actor.plan,
              structured:
                "Start with plan_records for the live revision, authority, record index and build readiness, then batch relevant ids for exact records. Reuse committed write receipts; read again when needed for unseen data or a conflict. Saved state is a tool result, not execution authority.",
              coverage:
                "plan_code exposes per-language source facts and static relationships; static bindings do not prove runtime behavior. plan_review saves scoped observations and source anchors. plan_models capabilities lists the models you can assign. plan_build plan shows whether the plan is ready to build.",
            }),
        }),
      );
    } catch (error) {
      removePlanner(id);
      throw error;
    }
  }

  return installPlanner;
}

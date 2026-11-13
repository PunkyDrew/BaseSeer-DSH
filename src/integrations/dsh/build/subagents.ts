import { PlanError } from "../../../domain/plan.ts";
import {
  BUILD_CHAT_TITLES,
  type BuildHost,
  type BuildRun,
  type BuildRuns,
  type LeadBrief,
  type ReadingRun,
  type Reviewer,
} from "../../../application/build/index.ts";
import {
  plannerLeadStopped,
  plannerReport,
  subagentInstructions,
} from "../../../application/build/briefs/index.ts";
import { planMap } from "../../../application/build/map.ts";
import { subagentPort } from "../../../application/build/ports.ts";
import type { Actor } from "../../../application/planning.ts";
import type { Records } from "../../../application/records.ts";
import type { ModelServices } from "../models.ts";
import type { NativeAgent } from "../native-session.ts";
import { promptAsBaseSeer } from "../owner-words.ts";
import { runAcceptanceCheck } from "./acceptance.ts";
import {
  buildEnvironment,
  checkBuildEnvironment,
  environmentBriefing,
  installedBrowsers,
  machineTools,
  type BuildEnvironment,
} from "./environment.ts";
import { commandsIn, hideWithheldTools, pollingGuard, readOnly, reviewOnly, withholdFromBuilds } from "./guards.ts";
import {
  buildCheckTool,
  buildMessageTool,
  hostServices,
  planMapTool,
  programWindowTool,
  projectCommandTool,
  recordCommandsTool,
} from "./tools.ts";

// On the owner's go, BaseSeer starts the build's lead: a standard DSH coding
// session in the project folder, on the model the plan gives it, whose
// subagents can run only on the models the plan builds its components on.
// BaseSeer makes the lead and every session it starts builders of the plan:
// the owner's words, the plan and the code standard as their instructions,
// and the tools to read the plan and run the project's commands. The planner
// hears from the build when its check passes, with the lead's report, and
// when the lead stops before, with its question. Once the build's check
// passes, two reviewers on the Planning chat's model, which share nothing with
// the build, judge it: one reads the owner's words against the code, and one
// uses the program as its owner would, in a copy of the project. The lead and
// the reviewers run with full access only while their build does. A
// validation the owner asks for, and the review of the plan at the go, is a
// session of its own, outside any build, that only reads.

/** DSH's permission preset that runs a session's commands without the sandbox and without asking. */
const FULL_ACCESS = "danger-full-access";

/**
 * The session event that holds the models a session's subagents may run on.
 * DSH's subagent tool reads it when the standard tools load, and the
 * subagents a session starts inherit it; without it, every subagent runs on
 * the session's own model.
 */
const SUBAGENT_MODELS = "subagent/model-selection-policy";

/** DSH's tool that lists a session's subagent models, there only when the session has the list. */
const SUBAGENT_MODEL_LIST = "list_subagent_models";

/**
 * The session event that selects a session's model. DSH's session controller
 * runs a session on the model its record selects, and on DSH's default
 * otherwise, whatever the session was created with.
 */
const MODEL_SELECTION = "model/selection";

/** A session of a build, whose model requests are counted towards it. */
type BuildSession = { role: "worker"; plan: string; usage: { run: string } };

/** How long after the lead's turn ends a subagent's report is sure to have reached it. */
const SETTLE_MS = 2000;

/** The text of a session's last answer. */
function lastAnswer(agent: any) {
  const session = agent?.session;
  for (let seq = (session?.seq ?? 0) - 1; seq >= 0; seq--) {
    const event = session.eventAt(seq);
    if (event?.type !== "assistant/message") continue;
    const text = textOf(event.data?.message?.content);
    if (text) return text;
  }
  return "";
}

const textOf = (parts: any) =>
  (Array.isArray(parts) ? parts : [])
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();

export function buildSessions(
  ctx: any,
  services: {
    builds: BuildRuns;
    records: Records;
    models: Pick<ModelServices, "route">;
  },
) {
  const { builds, records, models } = services;
  const browsers = installedBrowsers();
  /** The lead and subagents of each build, by session. */
  const sessions = new Map<string, BuildSession>();
  /** The sessions that read for the owner, whose model requests count towards each validation or plan review as a build's do towards it. */
  const readers = new Map<string, BuildSession>();
  /** The first line of each subagent's task, which the others know it by. */
  const tasks = new Map<string, string>();
  /** How many sessions each build has started, which gives each its own port. */
  const started = new Map<string, number>();
  /**
   * The model the owner chose for each running build's Planning chat, as it
   * was at the go: the review is judgment, and that is the model the owner
   * trusts with judgment about their project.
   */
  const reviewModels = new Map<string, { provider: string; model: string; reasoningEffort?: string }>();
  withholdFromBuilds(ctx, (session) => {
    const entry = sessions.get(session);
    return entry && (builds.running(entry.plan)?.id === entry.usage.run ? "running" : "ended");
  });
  ctx.on?.("agent/disposed", ({ agent }: any) => {
    sessions.delete(agent.id);
    readers.delete(agent.id);
    tasks.delete(agent.id);
  });

  const service = (name: string) => {
    try {
      return ctx.get?.(name);
    } catch {
      return undefined;
    }
  };

  /** Whether a session runs commands with full access, which a host without a sandbox always gives. */
  function fullAccess(session: unknown) {
    if (service("shell")?.sandboxMode === undefined) return true;
    return service("sandboxPolicy")?.resolve?.({ session })?.mode === FULL_ACCESS;
  }

  const agentsOf = (b: Pick<BuildRun, "id">) =>
    [...sessions]
      .filter(([, s]) => s.usage.run === b.id)
      .map(([id]) => ctx.agents.get(id))
      .filter(Boolean);
  const subagentsOf = (b: Pick<BuildRun, "id" | "lead" | Reviewer>) =>
    agentsOf(b).filter((agent: any) => ![b.lead, b.reviewer, b.tester].includes(agent.id));
  const working = (agent: any) =>
    agent.status === "running" || agent.inbox?.nextTurn?.length || agent.inbox?.nextStep?.length;

  /**
   * The build is over: the lead's session, which stays among the workspace's
   * chats, and any of its subagents still loaded go back to DSH's default
   * access. After a restart the lead is loaded again for it. The build has
   * ended either way, so a lead DSH cannot load is left as it is.
   */
  async function endAccess(b: Pick<BuildRun, "id" | "lead">) {
    const presets = service("permissionPresets");
    if (!presets) return;
    try {
      const lead = ctx.agents.get(b.lead) ?? (await ctx.sessionController.resolveAgent(b.lead)).agent;
      for (const agent of new Set([lead, ...agentsOf(b)].filter(Boolean)))
        presets.set(agent.session, presets.defaultPreset);
    } catch {
      /* The lead keeps the access its record holds. */
    }
  }

  /** BaseSeer's own message to a session: the owner's words are recorded from the owner's alone. */
  const tell = (sessionId: string, text: string) => promptAsBaseSeer(ctx, sessionId, text);

  /** A session's answer to BaseSeer's message: its last message once the turn that message starts is over. */
  function answer(sessionId: string, text: string) {
    return new Promise<string>((resolve, reject) => {
      const off = ctx.on("session/event", (session: { id: string }, event: any) => {
        if (session.id !== sessionId || event?.type !== "turn/end") return;
        off?.();
        resolve(lastAnswer(ctx.agents.get(sessionId)));
      });
      tell(sessionId, text).catch((error) => {
        off?.();
        reject(error);
      });
    });
  }

  /**
   * DSH summarizes the Planning chat while the build runs, once the
   * planner's turn is over, so the planner's own next requests carry the
   * summary instead of the whole conversation. The lead does not wait for
   * it: what the planning settled is in the plan.
   */
  async function summarize(chat: any) {
    await chat.whenIdle();
    try {
      await service("agentPresets")?.serviceFor(chat, "compaction")?.compactNow(chat, new AbortController().signal);
    } catch {
      /* The owner wrote again first: the planner carries the conversation instead. */
    }
  }

  /**
   * The model a chat runs on, read as DSH reads it: the owner's pick until the
   * chat's next request, then the model that request ran on.
   */
  function chatModel(chat: any) {
    if (!chat) return undefined;
    const pending = service("sessionProjections")?.stateOf(chat.session, "modelSelection")?.pending;
    const header = chat.session.requestHeader?.();
    const selection = pending ?? header?.config;
    if (!selection?.provider || !selection?.model) return undefined;
    const { provider, model, reasoningEffort } = selection;
    // A request that left the effort to the provider's default records the default, which is no pick.
    const effort = !pending && header?.adapterDefaults?.reasoningEffort === true ? undefined : reasoningEffort;
    return { provider, model, ...(effort ? { reasoningEffort: effort } : {}) };
  }

  /**
   * Names one of the build's chats before it joins the project's chats. DSH
   * would title it from its first message, BaseSeer's task, which says
   * neither whose chat it is nor that the owner talks in the Planning chat.
   */
  function title(session: unknown, text: string) {
    service("sessionTitle")?.rename(session, text);
  }

  /** The build's next port, for the lead or a subagent it starts. */
  function nextPort(b: Pick<BuildRun, "id" | "ports">) {
    const n = (started.get(b.id) ?? 0) + 1;
    started.set(b.id, n);
    return subagentPort(b.ports, n);
  }

  /** What the lead and every subagent get: the plan to read, the project's commands and their instructions. */
  function equip(scope: any, agent: any, b: BuildRun, environment: BuildEnvironment, instructions: () => string) {
    hideWithheldTools(scope);
    scope.tools.guard?.(pollingGuard(agent));
    scope.tools.register(planMapTool(agent, planMap(() => records.doc(b.plan), b.root)));
    scope.tools.register(recordCommandsTool(agent, (commands, untested) => builds.recordCommands(b.plan, commands, untested)));
    scope.tools.register(programWindowTool(agent, b.root));
    const access = hostServices(scope, ctx);
    if (access)
      scope.tools.register(
        projectCommandTool(agent, { cwd: b.root, commands: () => builds.commands(b.plan) }, environment, access),
      );
    scope.systemPrompt.section({
      name: "build-plan:build",
      order: 700,
      text: () => `${instructions()}\n\n${environmentBriefing(environment)}`,
    });
  }

  function equipSubagent(agent: NativeAgent, b: BuildRun) {
    const scope = agent.ctx as any;
    equip(scope, agent, b, buildEnvironment(nextPort(b), browsers), () =>
      subagentInstructions(
        records.doc(b.plan),
        records.store.ownerMessages.read(b.plan),
        b.project,
        b.change?.since.startedAt,
      ),
    );
    // A subagent's first message is the task the lead gave it.
    scope.on("session/event", (session: { id: string }, event: any) => {
      if (session.id !== agent.id || tasks.has(agent.id) || event?.type !== "user/message") return;
      tasks.set(agent.id, textOf(event.data?.content).split("\n")[0]);
    });
    scope.tools.register(
      buildMessageTool(agent, () =>
        subagentsOf(b).map((peer: any) => ({ id: peer.id, task: tasks.get(peer.id) ?? "", agent: peer })),
      ),
    );
  }

  async function startLead(actor: Actor, b: BuildRun, lead: LeadBrief) {
    const options = await models.route(actor, lead.route.model, lead.route.thinking);
    const planned = await Promise.all(lead.models.map((m) => models.route(actor, m.model, m.thinking)));
    const allowedModels = [
      ...new Map([options, ...planned].map(({ provider, model }) => [`${provider}/${model}`, { provider, model }])).values(),
    ];
    const presets = service("agentPresets");
    if (typeof presets?.mount !== "function")
      throw new PlanError("UNAVAILABLE", "DSH's agent presets are unavailable, so the lead cannot get the standard coding tools.");
    const environment = buildEnvironment(nextPort(b), browsers);
    const instructions = lead.instructions;
    // Before DSH announces the session, so it is the build's and never a planner or an ordinary chat.
    sessions.set(b.lead, { role: "worker", plan: b.plan, usage: { run: b.id } });
    const handle = await ctx.agents.create({
      sessionId: b.lead,
      meta: { cwd: b.root, agentPreset: "standard" },
      agentOptions: options,
      setup: async (scope: any, agent: any) => {
        const { provider, model, reasoningEffort } = options;
        agent.session.append(MODEL_SELECTION, { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
        // Before the standard tools load, so the subagent tool finds the list.
        agent.session.append(SUBAGENT_MODELS, { allowedModels });
        // Naming the preset in meta only records it: joining it gives the standard tools.
        await presets.mount(scope, "standard");
        equip(scope, agent, b, environment, () => instructions);
        scope.tools.register(buildCheckTool(agent, (fixed) => builds.check(b.plan, fixed)));
      },
    });
    const agent = handle.agent;
    if (!ctx.tools.get(SUBAGENT_MODEL_LIST, agent)) {
      await handle.dispose();
      throw new PlanError("UNAVAILABLE", "DSH's subagent tool did not take the plan's models, so the components could not be built on their planned models.");
    }
    // The subagents the lead starts take its access, and none of them can ask the owner to approve a command.
    if (!fullAccess(agent.session)) service("permissionPresets").set(agent.session, FULL_ACCESS);
    // In the project's workspace, the owner can watch the lead and its subagents.
    title(agent.session, BUILD_CHAT_TITLES.lead);
    await ctx.workspaceRegistry.get(b.workspace)?.attachSession(b.lead);
    await tell(b.lead, lead.task);
  }

  /**
   * One of the build's reviewers: a standard DSH session among the project's
   * chats, on the Planning chat's model, told nothing of the build but its
   * instructions. It reads and uses the project, running its commands in
   * `folder` (the project folder, or for the tester a copy of it) with its own
   * port, and has only the tools that read, run and use the program.
   */
  async function startReviewer(b: BuildRun, reviewer: Reviewer, folder: string, instructions: string) {
    const options = reviewModels.get(b.id);
    if (!options) throw new PlanError("UNAVAILABLE", "The Planning chat's model is unknown, so the review cannot start.");
    const environment = buildEnvironment(nextPort(b), browsers);
    sessions.set(b[reviewer], { role: "worker", plan: b.plan, usage: { run: b.id } });
    const handle = await ctx.agents.create({
      sessionId: b[reviewer],
      meta: { cwd: b.root, agentPreset: "standard" },
      agentOptions: options,
      setup: async (scope: any, agent: any) => {
        const { provider, model, reasoningEffort } = options;
        agent.session.append(MODEL_SELECTION, { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
        await service("agentPresets").mount(scope, "standard");
        scope.tools.guard?.(pollingGuard(agent));
        scope.tools.guard?.(commandsIn(agent, folder));
        const access = hostServices(scope, ctx);
        if (access)
          scope.tools.register(
            projectCommandTool(agent, { cwd: folder, commands: () => builds.commands(b.plan) }, environment, access),
          );
        scope.tools.register(programWindowTool(agent, folder));
        reviewOnly(scope, agent);
        scope.systemPrompt.section({
          name: "build-plan:review",
          order: 700,
          text: () => `${instructions}\n\n${environmentBriefing(environment)}`,
        });
      },
    });
    // It runs the project's commands as the lead does, with no one to approve them.
    if (!fullAccess(handle.agent.session)) service("permissionPresets").set(handle.agent.session, FULL_ACCESS);
    title(handle.agent.session, BUILD_CHAT_TITLES[reviewer]);
    await ctx.workspaceRegistry.get(b.workspace)?.attachSession(b[reviewer]);
  }

  /**
   * A session that reads for the owner, a validation of the code or a review
   * of the plan at the go: a standard DSH session in the project folder, on
   * the Planning chat's model, that reads the project and its plan and
   * reports. Every tool but those that read is refused it, so it needs no
   * access beyond DSH's default and never waits for the owner's approval.
   */
  async function startReader(v: ReadingRun, chatTitle: string, instructions: string) {
    const options = chatModel(ctx.agents.get(v.chat));
    if (!options) throw new PlanError("UNAVAILABLE", `The Planning chat's model is unknown, so the session "${chatTitle}" cannot start.`);
    readers.set(v.session, { role: "worker", plan: v.plan, usage: { run: v.id } });
    const handle = await ctx.agents.create({
      sessionId: v.session,
      meta: { cwd: v.root, agentPreset: "standard" },
      agentOptions: options,
      setup: async (scope: any, agent: any) => {
        const { provider, model, reasoningEffort } = options;
        agent.session.append(MODEL_SELECTION, { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
        await service("agentPresets").mount(scope, "standard");
        readOnly(scope, agent);
        scope.tools.register(planMapTool(agent, planMap(() => records.doc(v.plan), v.root)));
        scope.systemPrompt.section({ name: "build-plan:validate", order: 700, text: () => instructions });
      },
    });
    title(handle.agent.session, chatTitle);
    await ctx.workspaceRegistry.get(v.workspace)?.attachSession(v.session);
  }

  /**
   * The lead's turn is over with its build still running and nothing of the
   * build at work: it stopped before the check passed, with what it needs in
   * its last message. A subagent still working wakes it again with its report.
   */
  function leadSettled(b: BuildRun) {
    setTimeout(() => {
      const lead = ctx.agents.get(b.lead);
      if (builds.running(b.plan)?.id !== b.id || !lead || agentsOf(b).some(working)) return;
      const answer = lastAnswer(lead);
      builds.leadStopped(b.id, answer);
      void tell(b.chat, plannerLeadStopped(answer)).catch(() => undefined);
    }, SETTLE_MS);
  }
  ctx.on?.("session/event", (session: { id: string }, event: any) => {
    if (event?.type !== "turn/start" && event?.type !== "turn/end") return;
    const entry = sessions.get(session.id);
    const b = entry && builds.running(entry.plan);
    if (b?.lead !== session.id) return;
    if (event.type === "turn/end") leadSettled(b);
    else builds.leadStopped(b.id, undefined);
  });

  const host: BuildHost = {
    async check(actor, model, thinking) {
      await models.route(actor, model, thinking);
    },
    checkEnvironment: checkBuildEnvironment,
    runAcceptanceCheck: (input) => runAcceptanceCheck(input),
    machineTools,
    started(actor, b, lead) {
      const chat = ctx.agents.get(b.chat);
      const model = chatModel(chat);
      if (model) reviewModels.set(b.id, model);
      startLead(actor, b, lead).catch(async (error) => {
        sessions.delete(b.lead);
        const reason = `The build's lead could not start: ${(error as Error).message}`;
        builds.failed(b.id, reason);
        await tell(b.chat, `BaseSeer: ${reason} Tell the owner.`).catch(() => undefined);
      });
      if (chat) void summarize(chat);
    },
    async ended(b) {
      reviewModels.delete(b.id);
      await Promise.allSettled(
        agentsOf(b).map(async (agent: any) => agent.cancel({ kind: "user" }, { keepInbox: false })),
      );
      await endAccess(b);
    },
    // A subagent another has messaged works again, so the wait lasts until none is working.
    async subagentsDone(b) {
      const busy = () => subagentsOf(b).filter(working);
      for (let now = busy(); now.length; now = busy()) await Promise.all(now.map((agent: any) => agent.whenIdle()));
    },
    async completed(b) {
      reviewModels.delete(b.id);
      const lead = ctx.agents.get(b.lead);
      // The lead writes its report once its check has passed.
      await lead?.whenIdle();
      const report = lastAnswer(lead);
      builds.reported(b.id, report);
      await tell(b.chat, plannerReport(report, b.root, b.review, b.untested)).catch(() => undefined);
      await endAccess(b);
    },
    async review(b, reviewer, brief) {
      if (!ctx.agents.get(b[reviewer])) await startReviewer(b, reviewer, brief.folder, brief.instructions);
      return answer(b[reviewer], brief.task);
    },
    async tellLead(b, text) {
      await tell(b.lead, `The planner, from the Planning chat with the owner:\n\n${text}`);
    },
    async validate(v, brief) {
      await startReader(v, BUILD_CHAT_TITLES.validator, brief.instructions);
      return answer(v.session, brief.task);
    },
    async reviewPlan(r, brief) {
      await startReader(r, BUILD_CHAT_TITLES.planReviewer, brief.instructions);
      return answer(r.session, brief.task);
    },
    tell,
  };

  return {
    host,
    /** Model usage attribution: the requests of a build's lead and subagents, and of a validation or plan review, count towards it. */
    attribution: { get: (session: string) => sessions.get(session) ?? readers.get(session) },

    /**
     * Whether a session is a build's (its lead, or one its lead or a subagent
     * of it started) or one that reads for the owner. None becomes a planner or an ordinary
     * chat of the project.
     */
    owns(agent: NativeAgent) {
      return (
        sessions.has(agent.id) ||
        readers.has(agent.id) ||
        sessions.has(agent.session.header.parentSession ?? "")
      );
    },

    /**
     * Makes a session that the build's lead, or a subagent of it, started a
     * builder of the plan, as DSH creates it. One started after its build
     * ended joins it all the same, and gets no tools. A session that reads for the owner
     * is BaseSeer's already.
     */
    claim(agent: NativeAgent) {
      if (sessions.has(agent.id) || readers.has(agent.id)) return true;
      const parent = sessions.get(agent.session.header.parentSession ?? "");
      if (!parent) return false;
      sessions.set(agent.id, { ...parent });
      const b = builds.running(parent.plan);
      if (b?.id === parent.usage.run) equipSubagent(agent, b);
      return true;
    },
  };
}

export type BuildSessions = ReturnType<typeof buildSessions>;

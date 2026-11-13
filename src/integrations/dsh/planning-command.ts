import { PlanError } from "../../domain/plan.ts";
import { promptAsBaseSeer } from "./owner-words.ts";
import type { RequestServices } from "./request-services.ts";

/**
 * What /baseseer plan asks of the planner: the plan brought up to date with
 * everything known now, ending where the owner decides what comes next.
 */
const UPDATE_PLAN = `BaseSeer, at the owner's /baseseer plan: bring the plan up to date with everything known now, then tell the owner where it stands.
- What the owner has said in this chat, and what it settled that the plan does not hold yet.
- The project's code as it is now: plan_code coverage compares the planned components with the files; plan each file no component plans in the component it belongs to, and read what the plan describes otherwise than the code does.
- What BaseSeer has brought you here: a build's report, a validation's findings.
- What you can confirm on this machine or on the web, where the design depends on it.
Change the plan for all of it in as few writes as you can. Then call plan_build {command:{action:"plan"}} and tell the owner, in plain words: what you changed, whether the plan is ready to build and what stops it, what the next build would change, and each question only the owner can answer.`;

const USAGE =
  "Use /baseseer plan, /baseseer build, /baseseer validate, /baseseer repair [item numbers], /baseseer status, /baseseer undo, /baseseer start [project name], /baseseer normal, /baseseer accept <reviewed revision>, or /baseseer accept-proposal <id> <reviewed revision>.";

export function registerPlanningCommand(ctx: any, services: RequestServices) {
  const { records, bound, lifecycle, builds } = services;
  const { actors, sessionWorkspace, chooseMode } = lifecycle;
  /**
   * The owner's actions on the project as a whole: bringing the plan up to
   * date, the go for a build, a validation of the code and its repair. Each
   * is the owner's own, typed in the Planning chat, so nothing said in the
   * chat is taken for one. They run outside the chat's maintenance: a build
   * summarizes the chat once the command is done.
   */
  async function projectAction(agent: any, action: string, args: string[]) {
    const actor = actors.get(agent.id);
    if (!actor) return { kind: "error", text: `Type /baseseer ${action} in the project's Planning chat.` };
    if (action === "plan") {
      await promptAsBaseSeer(ctx, agent.id, UPDATE_PLAN);
      return { kind: "success", text: "The planner brings the plan up to date with this chat, the code and the reports BaseSeer brought it, and tells you here where it stands." };
    }
    if (agent.status === "running")
      return { kind: "error", text: `Wait for the planner to finish its answer, then type /baseseer ${action}.` };
    const items = args.join(" ").split(/[\s,]+/).filter(Boolean).map(Number);
    if (action === "repair" && items.some((n) => !Number.isInteger(n) || n < 1))
      return { kind: "error", text: "Type /baseseer repair alone to fix every item of the latest validation, or with the numbers of the items to fix, such as /baseseer repair 1 3." };
    try {
      const ws = await sessionWorkspace(agent.id);
      if (action === "validate") return { kind: "success", text: builds.validate(actor, ws.path, agent.id) };
      if (action === "build") return { kind: "success", text: await builds.go(actor, ws.path, agent.id) };
      const started = await builds.start(actor, ws.path, agent.id, items);
      return { kind: "success", text: started.instruction };
    } catch (error) {
      if (error instanceof PlanError) return { kind: "error", text: error.message };
      throw error;
    }
  }
  ctx.commands.register({
    name: "baseseer",
    description:
      "Bring the plan up to date, build it, validate the code against it, repair what a validation found, inspect status, undo, or accept a reviewed revision",
    input: {
      hint: "plan | build | validate | repair [item numbers] | status | undo | start [project name] | normal | accept <revision> | accept-proposal <id> <revision>",
    },
    handler: async ({ agent, rawInput, commandId }: any) => {
      const input = rawInput.trim(),
        [first = "status", ...args] = input.split(/\s+/),
        action = first.toLowerCase();
      if (["plan", "build", "validate", "repair"].includes(action)) return projectAction(agent, action, args);
      return agent.runMaintenance(async () => {
        const ws = await sessionWorkspace(agent.id);
        if (action === "normal") {
          await chooseMode(ws, agent, "normal");
          return {
            kind: "success",
            text: "Normal chat is active. Usual DSH tools and existing permissions apply; the shared BaseSeer is preserved.",
          };
        }
        if (action === "start") {
          await chooseMode(ws, agent, "planning", args.join(" "));
          return {
            kind: "success",
            text: "Planning is active in this chat. Describe the intended structure; I’ll maintain the shared draft as we talk. Open BaseSeer to explore it. Code reads observed source automatically when opened. Draft changes can be undone. Planning does not approve implementation or override DSH permissions.",
          };
        }
        const { actor } = bound(ws.id),
          current = records.read(actor.plan);
        if (!input || action === "status")
          return {
            kind: "success",
            text: `${current.title} · revision ${current.revision}\n${current.document.records.length} planning records. ${actors.has(agent.id) ? "Planning tools active in this chat." : "Choose Planning in the mode picker for a new chat, or use /baseseer start before this chat's first turn to enable planning."}\nDiscuss changes here; view them in BaseSeer. /baseseer plan brings the plan up to date, /baseseer build builds it, /baseseer validate checks the code against it and /baseseer repair fixes what a validation found. /baseseer undo reverses the latest draft change.`,
          };
        let command: any;
        if (action === "undo")
          command = { op: "undo", expected: current.revision };
        else if (
          action === "accept" &&
          args.length === 1 &&
          /^\d+$/.test(args[0])
        )
          command = {
            op: "baseline",
            expected: Number(args[0]),
            title: `Design accepted at revision ${args[0]}`,
          };
        else if (
          action === "accept-proposal" &&
          args.length === 2 &&
          /^\d+$/.test(args[1])
        )
          command = {
            op: "accept-proposal",
            proposal: args[0],
            expected: Number(args[1]),
          };
        else return { kind: "error", text: USAGE };
        const result = records.execute(actor, { ...command, key: commandId });
        return {
          kind: "success",
          text: `${result.summary}\n${action.startsWith("accept") ? "Design acceptance does not grant implementation permission." : "The shared view has updated."}`,
        };
      });
    },
  });
}

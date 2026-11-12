import { PlanError } from "../../domain/plan.ts";
import type { NativeAgent, NativeSessions } from "./native-session.ts";
import { markOwnRequest } from "./owner-words.ts";

type GenerationEvent =
  | { type: "start"; turn: number }
  | { type: "message"; request: string }
  | { type: "end"; turn: number; reason: string };
function generationEvent(value: unknown): GenerationEvent | undefined {
  if (!value || typeof value !== "object") return;
  const event = value as Record<string, unknown>;
  if (!event.data || typeof event.data !== "object") return;
  const data = event.data as Record<string, unknown>;
  if (event.type === "user/message") {
    const source = data.source as Record<string, unknown> | undefined;
    return source && typeof source.rpcId === "string"
      ? { type: "message", request: source.rpcId }
      : undefined;
  }
  if (!Number.isSafeInteger(data.turn) || (data.turn as number) < 0) return;
  if (event.type === "turn/start")
    return { type: "start", turn: data.turn as number };
  const reason = data.reason as Record<string, unknown> | undefined;
  if (event.type === "turn/end" && reason && typeof reason.kind === "string")
    return { type: "end", turn: data.turn as number, reason: reason.kind };
}

// Use the native controller so restored sessions retain their chosen model,
// provider route, effort and host prompt-admission checks.
export async function promptCodebaseGeneration(
  ctx: Pick<NativeSessions, "agents" | "sessionController" | "on">,
  agent: NativeAgent,
  requestId: string,
  prompt: string,
  allowed: () => boolean,
) {
  if (!allowed()) return;
  if (ctx.agents.get(agent.id) !== agent || agent.status === "running")
    throw new PlanError(
      "BUSY",
      "This chat started another response during scanning. The scan is saved; generate again when the chat is idle.",
    );
  let failure: unknown,
    currentTurn: number | undefined,
    turn: number | undefined,
    end: string | undefined;
  const unlisten = ctx.on("session/event", (session, input) => {
    if (session.id !== agent.id) return;
    const event = generationEvent(input);
    if (!event) return;
    if (event.type === "start") currentTurn = event.turn;
    // Session user/message data is the message itself. Its containing turn
    // comes from the preceding turn/start boundary, not a message wrapper.
    if (
      event.type === "message" &&
      event.request === requestId &&
      turn === undefined
    )
      turn = currentTurn;
    if (
      event.type === "end" &&
      end === undefined &&
      turn !== undefined &&
      event.turn === turn
    )
      end = event.reason;
  });
  const unerror = agent.ctx.on("agent/error", ({ error }) => {
    failure = error;
  });
  try {
    markOwnRequest(requestId);
    await ctx.sessionController.prompt(
      {
        requestId,
        sessionId: agent.id,
        mode: "queue",
        content: [{ type: "text", text: prompt }],
      },
      new AbortController().signal,
    );
    // A stop may race the native controller's asynchronous admission.
    if (!allowed()) await ctx.sessionController.cancel({ sessionId: agent.id });
    await agent.whenIdle();
    if (failure || end !== "completed")
      throw new PlanError(
        "INCOMPLETE",
        `Generation did not finish (${end ?? "no completed model turn"}). Saved work is retained; open chat for the model result before retrying.`,
      );
  } finally {
    unlisten();
    unerror();
  }
}

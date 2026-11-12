import { randomUUID } from "node:crypto";
import type {
  NativeAgent,
  NativeAgentContext,
  NativeUserMessage,
} from "./native-session.ts";

// Native DSH reports malformed JSON as "arguments must be an object". Provide
// the parser's precise diagnostic, without accepting, repairing or executing
// the rejected arguments. This is feedback within the current owner turn.
export function plannerArgumentFeedback(
  agent: NativeAgent,
  scope: NativeAgentContext,
) {
  let turn: number | undefined;
  let signal: AbortSignal | undefined;
  let detachAbort: (() => void) | undefined;
  const calls = new Map<string, { name: string; arguments: string }>();
  const pending: NativeUserMessage[] = [];
  const clear = () => {
    calls.clear();
    pending.length = 0;
  };
  const releases = [
    scope.on("agent/pre-step", async (event, next) => {
      if (event.agent !== agent) return next();
      if (turn !== event.turn) clear();
      turn = event.turn;
      signal = event.signal;
      detachAbort?.();
      signal.addEventListener("abort", clear, { once: true });
      detachAbort = () => event.signal.removeEventListener("abort", clear);
      const result = (await next()) as
        | { kind: string; messages?: NativeUserMessage[] }
        | undefined;
      // Session observers run inside append's publication boundary. Steering
      // there would reenter append and be rejected by DSH. Add diagnostic
      // context only at this already-authorized, awaited step boundary.
      if (
        result?.kind === "enter" &&
        !event.signal.aborted &&
        pending.length
      )
        return {
          ...result,
          messages: [...(result.messages ?? []), ...pending.splice(0)],
        };
      if (result?.kind === "reject") clear();
      return result;
    }),
    scope.on("session/event", (session, value) => {
      const event = value as any;
      if (
        session.id !== agent.id ||
        !signal ||
        signal.aborted ||
        event?.data?.turn !== turn
      )
        return;
      if (event.type === "tool/call") {
        if (
          [
            "plan_records",
            "plan_models",
            "plan_source",
            "plan_code",
            "plan_review",
            "plan_guide",
          ].includes(event.data.name) &&
          typeof event.data.arguments === "string" &&
          event.data.arguments.length <= 100000 &&
          calls.size < 32
        )
          calls.set(event.data.callId, event.data);
        return;
      }
      if (event.type !== "tool/result") return;
      const id = event.data.message?.source?.callId;
      const call = calls.get(id);
      calls.delete(id);
      if (
        !call ||
        event.data.error?.code !== "INVALID_ARGS" ||
        event.data.error?.name !== "ToolArgsError"
      )
        return;
      let detail: string;
      try {
        const parsed = JSON.parse(call.arguments);
        detail =
          typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
            ? "The top-level arguments must be a JSON object, not a JSON string, array or null."
            : "Follow the advertised tool schema. For plan_records and plan_models, pass the command object directly under command; do not wrap it in arguments or stringify it.";
      } catch (error) {
        // JSON.parse may quote input in diagnostics. Keep only its structural
        // message/position, never interpolate model-authored prose as guidance.
        const message = String((error as Error).message);
        const location = message.match(
          /(?:at position \d+)? ?\(line \d+ column \d+\)/,
        )?.[0];
        const expected = message.match(
          /^Expected (?:',' or '\]' after array element|',' or '\}' after property value|double-quoted property name|property name or '\}'|':' after property name)/,
        )?.[0];
        detail = `Malformed JSON: ${expected ?? "invalid JSON syntax"}${location ? " " + location : ""}. Check matching braces, array brackets, commas and quoting. For large record batches, save one coherent record per call when references permit.`;
      }
      const messageId = randomUUID();
      pending.push({
        id: messageId,
        role: "user",
        source: { kind: "plugin", plugin: "baseseer-tool-validation" },
        content: [
          {
            type: "text",
            text: `BaseSeer tool validation feedback for ${call.name}: ${detail} Nothing from this rejected call was saved. This does not grant implementation authority or a new turn.`,
          },
        ],
      });
    }),
    scope.on("agent/error", clear),
    scope.on("agent/turn-stopping", clear),
  ];
  return () => {
    clear();
    detachAbort?.();
    for (const release of releases.reverse()) release();
  };
}

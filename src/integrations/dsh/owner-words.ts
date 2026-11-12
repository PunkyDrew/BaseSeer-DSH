import { randomUUID } from "node:crypto";
import type { OwnerMessage } from "../../domain/plan.ts";

// A message BaseSeer queues in a chat, such as a codebase scan's
// instructions, reaches the chat as a user message just as the owner's own
// do. BaseSeer remembers the request of each message it sends, so the words
// it keeps as the owner's are only ever the owner's.

const sentByBaseSeer = new Set<string>();

/** Remembers a request BaseSeer sends into a chat as its own. */
export function markOwnRequest(requestId: string) {
  sentByBaseSeer.add(requestId);
}

/** Queues BaseSeer's own message in a chat, which its model answers in its next turn. */
export async function promptAsBaseSeer(ctx: any, sessionId: string, text: string) {
  const requestId = randomUUID();
  markOwnRequest(requestId);
  await ctx.sessionController.prompt(
    { requestId, sessionId, mode: "queue", content: [{ type: "text", text }] },
    new AbortController().signal,
  );
}

type Content = { type: string; text?: string }[];

type MessageEvent = {
  type?: string;
  time?: number;
  data?: {
    source?: { kind?: string; rpcId?: string };
    content?: Content;
    message?: { content?: Content };
  };
};

const textOf = (content: Content | undefined) =>
  (content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n")
    .trim();

/**
 * Reads one chat's session events for the owner's words: each message the
 * owner sent, with the planner's last reply to the owner before it, word for
 * word, since an answer such as "Yes, do that" says nothing without the
 * question it answers. The planner's reply to a message BaseSeer sent, such
 * as a build's report, is not one the owner was answering.
 */
export function ownerReader() {
  let said = "";
  let answeringOwner = false;
  return (event: unknown): OwnerMessage | undefined => {
    const e = event as MessageEvent | undefined;
    if (e?.type === "assistant/message") {
      if (answeringOwner) said = textOf(e.data?.message?.content) || said;
      return undefined;
    }
    const source = e?.data?.source;
    if (e?.type !== "user/message" || source?.kind !== "user") return undefined;
    const replyTo = said;
    said = "";
    answeringOwner = !(source.rpcId && sentByBaseSeer.has(source.rpcId));
    if (!answeringOwner) return undefined;
    const text = textOf(e.data?.content);
    if (!text) return undefined;
    const time = new Date(typeof e.time === "number" ? e.time : Date.now()).toISOString();
    return { time, text, ...(replyTo ? { replyTo } : {}) };
  };
}

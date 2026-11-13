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
    callId?: string;
    name?: string;
    arguments?: unknown;
    message?: {
      source?: { callId?: string };
      content?: (Content[number] & { content?: Content; isError?: boolean })[];
    };
  };
};

type Question = { id?: string; question?: string; options?: { label?: string }[] };
type Answer = { id?: string; selected?: string[]; custom?: string };

/** DSH's question form, whose answers reach the chat as the tool's result, not as a message. */
const QUESTION_TOOL = "ask_user_question";

const textOf = (content: Content | undefined) =>
  (content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n")
    .trim();

const timeOf = (e: MessageEvent) =>
  new Date(typeof e.time === "number" ? e.time : Date.now()).toISOString();

/** The questions of a call of the question form, or none when its arguments are not ones. */
function questionsOf(args: unknown): Question[] {
  try {
    const value = typeof args === "string" ? JSON.parse(args) : args;
    return Array.isArray(value?.questions) ? value.questions : [];
  } catch {
    return [];
  }
}

/** The answers in the question form's result, or none when the owner gave none. */
function answersOf(e: MessageEvent): Answer[] {
  const result = e.data?.message?.content?.find((part) => part.type === "tool-result");
  if (!result || result.isError) return [];
  try {
    const answers = JSON.parse(textOf(result.content)).answers;
    return Array.isArray(answers) ? answers : [];
  } catch {
    return [];
  }
}

const questionText = (question: Question, n: number) => {
  const options = (question.options ?? []).flatMap((option) => (option.label ? [option.label] : []));
  return `${n}. ${question.question ?? ""}${options.length ? ` (${options.join(" / ")})` : ""}`;
};

const answerText = (answer: Answer, n: number) =>
  `${n}. ${[...(answer.selected ?? []), ...(answer.custom ? [answer.custom] : [])].join("; ")}`;

/**
 * The owner's answers in the question form, numbered like the questions they
 * answer, which stand in for the planner's reply they answer.
 */
function formAnswers(questions: Question[], answers: Answer[], time: string): OwnerMessage | undefined {
  const answered = questions.flatMap((question) => {
    const answer = answers.find((a) => a.id === question.id);
    return answer?.selected?.length || answer?.custom ? [{ question, answer }] : [];
  });
  if (!answered.length) return undefined;
  return {
    time,
    text: answered.map(({ answer }, i) => answerText(answer, i + 1)).join("\n"),
    replyTo: answered.map(({ question }, i) => questionText(question, i + 1)).join("\n"),
  };
}

/**
 * Reads one chat's session events for the owner's words: each message the
 * owner sent, with the planner's last reply to the owner before it, word for
 * word, since an answer such as "Yes, do that" says nothing without the
 * question it answers, and the owner's answers in DSH's question form, with
 * the questions. The planner's reply to a message BaseSeer sent, such as a
 * build's report, is not one the owner was answering.
 */
export function ownerReader() {
  let said = "";
  let answeringOwner = false;
  /** The question form's open calls, by call: the questions their results answer. */
  const asked = new Map<string, Question[]>();
  return (event: unknown): OwnerMessage | undefined => {
    const e = event as MessageEvent | undefined;
    if (e?.type === "assistant/message") {
      if (answeringOwner) said = textOf(e.data?.message?.content as Content) || said;
      return undefined;
    }
    if (e?.type === "tool/call") {
      if (e.data?.name === QUESTION_TOOL && e.data.callId) asked.set(e.data.callId, questionsOf(e.data.arguments));
      return undefined;
    }
    if (e?.type === "tool/result") {
      const call = e.data?.message?.source?.callId ?? "";
      const questions = asked.get(call);
      asked.delete(call);
      if (!questions) return undefined;
      const answers = formAnswers(questions, answersOf(e), timeOf(e));
      // Only the owner answers the form, even when the planner asks it while
      // answering BaseSeer's message, such as the gaps a plan review found:
      // the planner's replies after it answer the owner.
      if (!answers) return undefined;
      said = "";
      answeringOwner = true;
      return answers;
    }
    const source = e?.data?.source;
    if (e?.type !== "user/message" || source?.kind !== "user") return undefined;
    const replyTo = said;
    said = "";
    answeringOwner = !(source.rpcId && sentByBaseSeer.has(source.rpcId));
    if (!answeringOwner) return undefined;
    const text = textOf(e.data?.content);
    if (!text) return undefined;
    return { time: timeOf(e), text, ...(replyTo ? { replyTo } : {}) };
  };
}

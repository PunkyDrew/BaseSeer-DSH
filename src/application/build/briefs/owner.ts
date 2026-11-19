import type { OwnerMessage } from "../../../domain/plan.ts";

// The plan is a design, not a substitute for what the owner actually said.
// A session reads the owner's words in its conversation, as its first message
// or a tool's answer, and never in its system prompt: the words grow with
// every planning message, and a system prompt goes whole with every request,
// where DSH cannot summarize it as it does a conversation that grows long.

const when = (time: string) => time.slice(0, 16).replace("T", " ");

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

/** What a session that BaseSeer does not hand the owner's words is told, to read them itself. */
export const readOwnerWords = `The owner described this project to a planner in a Planning chat. Their messages say what the project must do, and a later message can change an earlier one. Read them before anything else: owner_messages {} returns them word for word, each with its number, and owner_messages {number:N} returns message N with the planner's text it answers.`;

/** The most characters of the owner's words one reading holds: about a long source file's. */
const READING = 32000;

/**
 * The owner's messages numbered below `before`, word for word and oldest
 * first: the latest whole ones that one reading holds, each with its number,
 * and how to read the rest. Those sent after `since` are marked new.
 */
export function ownerWords(messages: OwnerMessage[], since?: string, before = messages.length + 1) {
  if (!messages.length)
    return "The owner's messages: none are kept for this project, so build what the map describes.";
  const end = Math.min(before, messages.length + 1) - 1;
  let start = end;
  for (let size = 0; start > 0; start--) {
    size += messages[start - 1]!.text.length;
    if (start < end && size > READING) break;
  }
  const entries = messages.slice(start, end).map((m, i) => {
    const fresh = since !== undefined && m.time > since ? ", new since the last build" : "";
    return `[#${start + i + 1}, ${when(m.time)}${fresh}]\n${m.text}`;
  });
  const earlier = start
    ? ` Messages 1 to ${start} came before these: owner_messages {before:${start + 1}} returns them.`
    : "";
  return `The owner's messages in the Planning chat, word for word, oldest first, each with its number. Where one answers the planner, as a bare "yes" does, read what it answers before you act on it: owner_messages {number:N} returns message N with the planner's text it answers.${earlier}\n\n${entries.join("\n\n")}`;
}

/** One owner message by its number with the planner's text it answers, neither shortened: a short answer means what it answers. */
export function ownerExchange(messages: OwnerMessage[], number: number) {
  const m = messages[number - 1];
  if (!m) return undefined;
  const head = `[#${number}, ${when(m.time)}]`;
  return m.replyTo
    ? `${head} The planner had written:\n${quoted(m.replyTo)}\nThe owner answered:\n${m.text}`
    : `${head}\n${m.text}`;
}

import type { OwnerMessage } from "../../../domain/plan.ts";

// Every agent that writes a project's code reads what the owner asked for in
// the owner's own words: the plan restates them, and a restatement drifts.
// An answer comes with the planner's message it answers, which it needs to
// say anything.

const when = (time: string) => time.slice(0, 16).replace("T", " ");

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

/** The owner's messages in full, oldest first; those sent after `since` are marked new. */
export function ownerSection(messages: OwnerMessage[], since?: string) {
  if (!messages.length)
    return "The owner's messages: none are kept for this project, so build what the map describes.";
  const entries = messages.map((m) => {
    const fresh = since !== undefined && m.time > since ? ", new since the last build" : "";
    const head = `[${when(m.time)}${fresh}]`;
    return m.replyTo
      ? `${head} The planner had written:\n${quoted(m.replyTo)}\nThe owner answered:\n${m.text}`
      : `${head}\n${m.text}`;
  });
  return `The owner's messages in the Planning chat, word for word, oldest first:\n\n${entries.join("\n\n")}`;
}

import type { OwnerMessage } from "../../../domain/plan.ts";

// The plan is a design, not a substitute for what the owner actually said.

const when = (time: string) => time.slice(0, 16).replace("T", " ");

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

// The planner puts ordinary-chat decisions in a self-contained final block.
// Question-form exchanges already contain just questions and options.
const decisionHeading = /^For your decision:[ \t]*\r?$/im;
const listItem = /^\s*(?:[-+*]|\*{0,2}\d+[.)]|[A-Z][.)]|\|)\s/m;
const sectionTitle = /^#{1,6}\s+[^\n]+/;
const offer = /\b(?:I(?:['’]d| would) (?:suggest|recommend|propose|change)|I (?:suggest|recommend|propose)|(?:my|the|our|your) (?:suggestions?|recommendations?|proposals?|options?|choices?)\b|(?:suggestions|recommendations|proposals|options|choices):)/i;
const pointsBack = /\b(?:yes|no|yeah|sure|ok(?:ay)?|agreed?|both|all|that|those|these|them|it|one|first|second|third|latter|former)\b/i;
const dependentQuestion = /\b(?:that|this|these|those|them|it|which|proceed|go ahead|sound good|agree)\b|\b(?:shall|should|can) (?:I|we)\s*\?/i;

/** Select text, never summarize it. Free-form history can have a proposal far
 * above its final question; if an answer points back into unlabelled prose,
 * keep the reply rather than invent what the owner meant. */
function decisionContext({ replyTo, text }: OwnerMessage): string {
  if (!replyTo) return "";
  const heading = decisionHeading.exec(replyTo);
  if (heading) return replyTo.slice(heading.index);

  // The question form numbers both sides, including prompts like “Pick a size”
  // that have no question mark. Its stored reply has no surrounding discussion.
  if (/^1\. /.test(replyTo) && /^1\. /.test(text)) return replyTo;
  const blocks = replyTo.split(/\r?\n[ \t]*\r?\n/);
  const kept = new Map<number, string>();
  let title = -1;
  let offered = false;
  for (const [i, block] of blocks.entries()) {
    if (sectionTitle.test(block)) title = i;
    const proposes = offer.test(block);
    if (!proposes && !/\?(?=[\s*_”'"’)]|$)/.test(block)) continue;
    if (title >= 0 && !kept.has(title)) kept.set(title, blocks[title]!.match(sectionTitle)![0]);
    kept.set(i, block);
    offered ||= proposes;
    // Options may precede rather than follow the question. Keep their lead-in
    // too when it is a separate paragraph ending in a colon.
    if (block.includes("?") && i > 0 && listItem.test(blocks[i - 1]!)) {
      let j = i - 1;
      while (j >= 0 && listItem.test(blocks[j]!)) { kept.set(j, blocks[j]!); j--; }
      if (j >= 0 && /:\s*\**$/.test(blocks[j]!)) kept.set(j, blocks[j]!);
    }
    let j = i + 1;
    while (j < blocks.length && !sectionTitle.test(blocks[j]!) && listItem.test(blocks[j]!)) {
      kept.set(j, blocks[j]!);
      j++;
    }
    // A proposal heading may introduce several paragraphs of ordinary prose.
    if (proposes && j === i + 1 && !listItem.test(block) && /:\s*\**$/.test(block))
      while (j < blocks.length && !sectionTitle.test(blocks[j]!)) {
        kept.set(j, blocks[j]!);
        j++;
      }
  }
  // A confirmation can refer to an unlabelled proposal (“go ahead?”), or
  // cross-reference several numbered sections. Keep the original scope: a
  // naked question, or numbered choices stripped of their subjects, can invert
  // the decision. No length cap may cut an option or qualification in half.
  const excerpt = [...kept.values()].join("\n");
  if (pointsBack.test(text) && (/#\d+/.test(excerpt) || (!offered && (!excerpt || dependentQuestion.test(excerpt))))) return replyTo;
  return blocks.flatMap((_, i) => kept.has(i) ? [kept.get(i)!] : []).join("\n\n");
}

/** The owner's messages in full, oldest first; those sent after `since` are marked new. */
export function ownerSection(messages: OwnerMessage[], since?: string, view: "full" | "lead" = "full") {
  if (!messages.length)
    return "The owner's messages: none are kept for this project, so build what the map describes.";
  const entries = messages.map((m, i) => {
    const fresh = since !== undefined && m.time > since ? ", new since the last build" : "";
    const head = `[${view === "lead" ? `#${i + 1}, ` : ""}${when(m.time)}${fresh}]`;
    const context = view === "lead" ? decisionContext(m) : m.replyTo;
    return context
      ? `${head} The planner had written:\n${quoted(context)}\nThe owner answered:\n${m.text}`
      : `${head}\n${m.text}`;
  });
  const lookup = view === "lead"
    ? ' Planner text is excerpted. If a reference is unclear, read its complete exchange before acting: plan_map {command:{action:"exchange",number:N}}, using the number on that owner message.'
    : "";
  return `The owner's messages in the Planning chat, word for word, oldest first:${lookup}\n\n${entries.join("\n\n")}`;
}

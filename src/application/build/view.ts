import { apiEquivalentCost } from "../../domain/model-usage.ts";
import { REVIEWERS, type BuildRun } from "./model.ts";

type UsageSum = {
  requests: number;
  tokens: number;
  usd: number;
  unpriced: number;
};

const emptySum = (): UsageSum => ({
  requests: 0,
  tokens: 0,
  usd: 0,
  unpriced: 0,
});

/**
 * Model requests BaseSeer observed for this build's lead and subagents, and
 * the review of the plan at its go, in all, the lead's and per model: counts,
 * tokens and API-equivalent cost at dated reference rates (unpriced ones
 * counted).
 */
function buildUsage(b: BuildRun, rows: any[]) {
  const total = emptySum();
  const lead = emptySum();
  const byModel: Record<string, UsageSum> = {};
  for (const row of rows) {
    if (row.run !== b.id && row.run !== b.planReview) continue;
    const cost = apiEquivalentCost(row.tokens, row.rate);
    const sums = [total, (byModel[`${row.provider}/${row.model}`] ??= emptySum()), ...(row.session === b.lead ? [lead] : [])];
    for (const sum of sums) {
      sum.requests++;
      sum.tokens += row.tokens?.totalTokens ?? 0;
      if (cost) sum.usd += cost.usd;
      else sum.unpriced++;
    }
  }
  return { total, lead, byModel };
}

/**
 * Where each review session's context came from, to tell a session that
 * starts large from one that grows as it works, which need different
 * remedies: of its largest request, the characters of the system prompt and
 * tool definitions it starts with, DSH's and BaseSeer's together, those of
 * tool output and those of the conversation besides; and
 * how often DSH compacted it, with the output that cost. Requests whose
 * provider reported no tokens are counted apart, as unknown rather than none.
 */
function reviewContext(b: BuildRun, rows: any[]) {
  return REVIEWERS.flatMap((reviewer) => {
    const mine = rows.filter((row) => row.run === b.id && row.session === b[reviewer]);
    if (!mine.length) return [];
    const largest = mine.reduce((top, row) => (row.requestChars > top.requestChars ? row : top));
    const compactions = mine.filter((row) => row.purpose === "compaction");
    return [{
      reviewer,
      requests: mine.length,
      starting: largest.prefixChars,
      tools: largest.toolChars,
      conversation: Math.max(0, largest.requestChars - largest.prefixChars - largest.toolChars),
      compactions: compactions.length,
      compactionOutput: compactions.reduce((sum, row) => sum + (row.tokens?.outputTokens ?? 0), 0),
      unknownTokens: mine.filter((row) => !row.tokens).length,
    }];
  });
}

/** A build as the Build view and the planner see it: the saved run without the project's path, with its usage, the lead's and its subagents'. */
export function buildView(b: BuildRun, usageRows: any[]) {
  const { root: _root, ...saved } = b;
  const usage = buildUsage(b, usageRows);
  return {
    ...saved,
    usage: usage.total,
    leadUsage: usage.lead,
    usageByModel: usage.byModel,
    reviewContext: reviewContext(b, usageRows),
  };
}

import { apiEquivalentCost } from "../../domain/model-usage.ts";
import type { BuildRun } from "./model.ts";

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
 * Model requests BaseSeer observed for this build's lead and subagents, in
 * all, the lead's and per model: counts, tokens and API-equivalent cost at
 * dated reference rates (unpriced ones counted).
 */
function buildUsage(b: BuildRun, rows: any[]) {
  const total = emptySum();
  const lead = emptySum();
  const byModel: Record<string, UsageSum> = {};
  for (const row of rows) {
    if (row.run !== b.id) continue;
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

/** A build as the Build view and the planner see it: the saved run without the project's path, with its usage, the lead's and its subagents'. */
export function buildView(b: BuildRun, usageRows: any[]) {
  const { root: _root, ...saved } = b;
  const usage = buildUsage(b, usageRows);
  return { ...saved, usage: usage.total, leadUsage: usage.lead, usageByModel: usage.byModel };
}

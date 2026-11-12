import {
  deepSeekRates,
  deepSeekPeriod,
  deepSeekPricingAsOf,
  deepSeekPricingSource,
} from "./deepseek-pricing.ts";

export interface ModelTokens {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
}
export interface ReferenceRate {
  model: string;
  asOf: string;
  source: string;
  currency: "USD";
  basis: string;
  input: number;
  cacheRead: number;
  cacheWrite: number | null;
  output: number;
  longContextAbove?: number;
}
export interface ModelUsage {
  id: string;
  plan: string;
  session: string;
  /** The build a request belongs to: the subagents a planner starts for it. */
  run?: string;
  stage: "planning" | "build";
  purpose?: "compaction" | "session-title";
  provider: string;
  model: string;
  started: number;
  ended?: number;
  outcome: "started" | "finished" | "error" | "aborted" | "interrupted";
  prefixSha256: string;
  prefixChars: number;
  requestChars: number;
  tokens: ModelTokens | null;
  invalidUsage?: boolean;
  rate: ReferenceRate | null;
}

// DSH 0.1.5 TokenUsage counts uncached/cache-read/cache-write input separately.
// Reasoning is a subset of output. Do not subtract cache twice or add reasoning.
export function modelTokens(value: any): ModelTokens | null {
  const counter = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!value || !counter(value.inputTokens) || !counter(value.outputTokens))
    return null;
  const inputTokens = value.inputTokens,
    outputTokens = value.outputTokens;
  const cacheReadTokens =
      value.cacheReadTokens === undefined ? 0 : value.cacheReadTokens,
    cacheWriteTokens =
      value.cacheWriteTokens === undefined ? 0 : value.cacheWriteTokens;
  if (!counter(cacheReadTokens) || !counter(cacheWriteTokens)) return null;
  const totalTokens =
    inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
  if (
    !counter(totalTokens) ||
    (value.totalTokens !== undefined && value.totalTokens !== totalTokens)
  )
    return null;
  if (
    value.reasoningTokens !== undefined &&
    (!counter(value.reasoningTokens) || value.reasoningTokens > outputTokens)
  )
    return null;
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens,
    ...(value.reasoningTokens !== undefined
      ? { reasoningTokens: value.reasoningTokens }
      : {}),
  };
}

export function apiEquivalentRate(
  model: string,
  at: number,
): ReferenceRate | null {
  // [input, cacheRead, cacheWrite, output] per million tokens, with when and where each was read.
  const openai: Record<
    string,
    { rates: [number, number, number, number]; asOf: string; source: string }
  > = {
    "gpt-6.1-sol": {
      rates: [2, 0.1, 2.5, 10],
      asOf: "2026-10-07",
      source: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    },
    "gpt-6-astra": {
      rates: [10, 1, 12.5, 50],
      asOf: "2026-10-07",
      source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    },
    "gpt-6-luna": {
      rates: [0.1, 0.01, 0.125, 0.5],
      asOf: "2026-10-08",
      source: "https://developers.openai.com/api/docs/pricing",
    },
    "gpt-6-sol": {
      rates: [2, 0.2, 2.5, 10],
      asOf: "2026-10-21",
      source: "https://developers.openai.com/api/docs/pricing",
    },
    "gpt-5.6-sol": {
      rates: [4, 0.4, 5, 20],
      asOf: "2026-10-21",
      source: "https://developers.openai.com/api/docs/pricing",
    },
    "gpt-5.6-terra": {
      rates: [2, 0.2, 2.5, 12],
      asOf: "2026-10-21",
      source: "https://developers.openai.com/api/docs/pricing",
    },
    "gpt-5.6-luna": {
      rates: [0.2, 0.02, 0.25, 1.2],
      asOf: "2026-10-21",
      source: "https://developers.openai.com/api/docs/pricing",
    },
  };
  const row = Object.hasOwn(openai, model) ? openai[model] : undefined;
  if (row)
    return {
      model,
      asOf: row.asOf,
      source: row.source,
      currency: "USD",
      basis:
        "Standard API-equivalent text-token reference; excludes service-tier/regional premiums and non-token tool charges",
      input: row.rates[0],
      cacheRead: row.rates[1],
      cacheWrite: row.rates[2],
      output: row.rates[3],
      longContextAbove: 272000,
    };
  const period = deepSeekPeriod(at);
  const deepseek = deepSeekRates.find((r) => r.model === model);
  if (!deepseek || period === "unknown") return null;
  const rates = deepseek[period === "peak" ? "peak" : "offPeak"];
  return {
    model,
    asOf: deepSeekPricingAsOf,
    source: deepSeekPricingSource,
    currency: "USD",
    basis: `Published ${period} API-equivalent reference at request start`,
    input: rates[1],
    cacheRead: rates[0],
    cacheWrite: null,
    output: rates[2],
  };
}

export function apiEquivalentCost(
  tokens: ModelTokens | null,
  rate: ReferenceRate | null,
) {
  if (
    !tokens ||
    !rate ||
    (tokens.cacheWriteTokens > 0 && rate.cacheWrite === null)
  )
    return null;
  const prompt =
    tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  const long =
    rate.longContextAbove !== undefined && prompt > rate.longContextAbove;
  const inputScale = long ? 2 : 1,
    outputScale = long ? 1.5 : 1;
  const parts = {
    input: (tokens.inputTokens * rate.input * inputScale) / 1e6,
    cacheRead: (tokens.cacheReadTokens * rate.cacheRead * inputScale) / 1e6,
    cacheWrite:
      (tokens.cacheWriteTokens * (rate.cacheWrite ?? 0) * inputScale) / 1e6,
    output: (tokens.outputTokens * rate.output * outputScale) / 1e6,
  };
  return {
    ...parts,
    usd: Object.values(parts).reduce((a, b) => a + b, 0),
    longContext: long,
  };
}

export function usageReport(rows: ModelUsage[]) {
  const requests = [...new Map(rows.map((r) => [r.id, r])).values()];
  const groups = new Map<string, any>();
  for (const row of requests) {
    const key = JSON.stringify([
      row.stage,
      row.provider,
      row.model,
      row.run ?? null,
      row.purpose ?? null,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        stage: row.stage,
        provider: row.provider,
        model: row.model,
        run: row.run ?? null,
        purpose: row.purpose ?? null,
        requests: 0,
        missingUsage: 0,
        unpricedRequests: 0,
        unfinishedRequests: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        knownApiEquivalentUsd: 0,
        prefixHashes: new Set<string>(),
        rates: new Map<string, ReferenceRate>(),
      };
      groups.set(key, group);
    }
    group.requests++;
    group.prefixHashes.add(row.prefixSha256);
    if (row.rate) group.rates.set(JSON.stringify(row.rate), row.rate);
    if (row.outcome === "started") group.unfinishedRequests++;
    if (!row.tokens) group.missingUsage++;
    else
      for (const field of [
        "inputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "outputTokens",
        "totalTokens",
      ])
        group[field] += (row.tokens as any)[field];
    const cost = apiEquivalentCost(row.tokens, row.rate);
    if (cost) group.knownApiEquivalentUsd += cost.usd;
    else group.unpricedRequests++;
  }
  const result = [...groups.values()].map(({ prefixHashes, rates, ...g }) => ({
    ...g,
    distinctPromptPrefixes: prefixHashes.size,
    rates: [...rates.values()],
    cacheReadFraction:
      g.inputTokens + g.cacheReadTokens + g.cacheWriteTokens
        ? g.cacheReadTokens /
          (g.inputTokens + g.cacheReadTokens + g.cacheWriteTokens)
        : null,
  }));
  const sum = (field: string) => result.reduce((n, g) => n + g[field], 0);
  return {
    requests: requests.length,
    missingUsage: sum("missingUsage"),
    unpricedRequests: sum("unpricedRequests"),
    unfinishedRequests: sum("unfinishedRequests"),
    inputTokens: sum("inputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
    knownApiEquivalentUsd: sum("knownApiEquivalentUsd"),
    complete:
      requests.length > 0 &&
      sum("unpricedRequests") === 0 &&
      sum("unfinishedRequests") === 0,
    groups: result,
    basis:
      "Observed DSH model requests since telemetry was installed, including repairs, continuation and auxiliary calls. Dated API-equivalent rates; unpricedRequests counts incomplete cost estimates caused by missing token counts or unavailable rates, never zero-cost completed work. Prefix variation is diagnostic evidence, not a proven cause of cache misses.",
  };
}

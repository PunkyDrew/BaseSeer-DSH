import type { DataFolder } from "../../storage/data-folder.ts";
import { deepSeekPricing, deepSeekRates } from "../../domain/deepseek-pricing.ts";
import { apiEquivalentRate } from "../../domain/model-usage.ts";
import { object, PlanError, revision } from "../../domain/plan.ts";

// Read endpoint identity only. This module never reads or sends an API key.
export function deepSeekRoute(
  ctx: any,
  provider: string,
  model?: string,
): "official" | "custom" | undefined {
  const entry = ctx.llm
    .listConfigurableProviders?.()
    .find((p: any) => p.provider === provider);
  if (!entry || !["llm-deepseek", "llm-pi-ai"].includes(entry.settingsNs))
    return;
  let profile = ctx.get?.("settings")?.describe({ redactSecrets: true })
    .find((descriptor: any) => descriptor.ns === entry.settingsNs)?.value;
  for (const key of entry.settingsPath ?? []) profile = profile?.[key];
  if (!profile || entry.error)
    return entry.settingsNs === "llm-deepseek" ? "custom" : undefined;
  const override =
    (profile.models ?? []).find((m: any) => m.id === model) ??
    profile.modelOverrides?.[model ?? ""];
  const env = ctx.get?.("launchEnvironment");
  let base = override?.baseUrl ?? override?.baseURL ?? profile.baseURL;
  if (entry.settingsNs === "llm-deepseek")
    base ??=
      (env
        ? env.get("DEEPSEEK_BASE_URL")?.value
        : process.env.DEEPSEEK_BASE_URL) ?? "https://api.deepseek.com";
  else if (provider === "deepseek") base ??= "https://api.deepseek.com";
  try {
    const url = new URL(base);
    if (
      url.origin === "https://api.deepseek.com" &&
      !url.username &&
      !url.password
    )
      return "official";
  } catch {
    /* Unknown endpoints have no verified pricing. */
  }
  return entry.settingsNs === "llm-deepseek" ? "custom" : undefined;
}

// Dated public reference rates for planning, never account usage or credentials:
// the same rates that price the requests BaseSeer observes, subscription routes
// included, since a subscription's window goes down faster on a dearer model.
export function modelReferencePrices(
  ctx: any,
  models: { provider: string; id: string }[],
  now = Date.now(),
) {
  const result: Record<string, any> = {};
  for (const model of models) {
    // DeepSeek's published prices hold only at its own endpoint, whatever adapter routes to it.
    if (
      deepSeekRates.some((r) => r.model === model.id) &&
      deepSeekRoute(ctx, model.provider, model.id) !== "official"
    )
      continue;
    const rate = apiEquivalentRate(model.id, now);
    if (!rate) continue;
    result[`${model.provider}/${model.id}`] = {
      apiPrice: {
        inputPerMillion: rate.input,
        outputPerMillion: rate.output,
        currency: rate.currency,
        source: rate.source,
        asOf: rate.asOf,
      },
      cacheHitInputPerMillion: rate.cacheRead,
      basis: rate.basis,
      limitations:
        "Published reference rates as of apiPrice.asOf, not live billing or a guarantee of future prices. Input reference uses the uncached rate; keep cache-hit pricing separate.",
    };
  }
  return result;
}

export function providerPricing(
  ctx: any,
  storage: DataFolder["pricing"],
  clock = Date.now,
) {
  const read = (provider?: string) => {
    const row = storage.read();
    return {
      revision: row.revision,
      blockPeak: row.blockPeak,
      pricing: deepSeekPricing(clock()),
      route: provider ? deepSeekRoute(ctx, provider) : "official",
    };
  };
  const dispatch = (input: unknown) => {
    const q = object(input ?? {}, [
      "action",
      "provider",
      "expected",
      "blockPeak",
    ]);
    if (q.action === "read")
      return read(typeof q.provider === "string" ? q.provider : undefined);
    if (q.action !== "save" || typeof q.blockPeak !== "boolean")
      throw new PlanError(
        "INVALID",
        "Choose whether to block DeepSeek peak requests",
      );
    const expected = revision(q.expected);
    const saved = storage.save(q.blockPeak, expected);
    if (!saved)
      throw new PlanError(
        "CONFLICT",
        "DeepSeek pricing settings changed. Reload before saving.",
      );
    return read(typeof q.provider === "string" ? q.provider : undefined);
  };
  function assertAllowed(provider: string, model?: string) {
    const config = read();
    if (!config.blockPeak) return;
    const route = deepSeekRoute(ctx, provider, model);
    // Also fail closed for custom DeepSeek-adapter endpoints: published rates
    // cannot establish their billing, but the user's enabled protection remains.
    if (route && config.pricing.period !== "off-peak")
      throw new PlanError(
        "PEAK_BLOCKED",
        config.pricing.period === "peak"
          ? "DeepSeek requests are blocked during peak pricing. Wait for off-peak hours or turn off the block in Settings → Models → DeepSeek."
          : "DeepSeek requests are blocked because this year's holiday calendar is unverified. Update the pricing calendar or turn off the block in Settings → Models → DeepSeek.",
      );
  }
  ctx.on(
    "llm/stream",
    async function* (options: any, next: () => AsyncIterable<any>) {
      assertAllowed(options.provider, options.model);
      yield* next();
    },
  );
  return { read, dispatch, assertAllowed };
}

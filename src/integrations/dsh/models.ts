import { PlanError } from "../../domain/plan.ts";
import { billingEligibility } from "../../domain/model-ladder.ts";
import {
  modelModes,
  policyEligibility,
  projectModelPolicy,
} from "../../domain/model-policy.ts";
import {
  isSubscriptionOnlyMode,
  quotaContext,
} from "../../domain/subscription-quota.ts";
import {
  capabilityQuery,
  planningCapabilities,
} from "../../application/planning-capabilities.ts";
import { routeModel } from "../../application/model-route.ts";
import { readApiBalances } from "./api-balances.ts";
import { discoverWorkModels } from "./model-catalog.ts";
import { modelReferencePrices } from "./provider-pricing.ts";
import { readSubscriptionCapacity } from "./subscription-capacity.ts";
import { usageQuery } from "./usage-query.ts";

type Actor = { role: string; plan: string };

/**
 * The models BaseSeer can use: what DSH offers, what the owner's model
 * policy and subscriptions allow, reference prices and balances, the route a
 * subagent gets for a planned model, and the usage recorded so far.
 */
export function modelServices(
  ctx: any,
  records: { read(plan: string): { document: any }; store: any },
  options: {
    pricing?: any;
    /** True while a build of the plan runs, so model settings wait for it. */
    building?: (plan: string) => boolean;
  } = {},
) {
  /** DSH's models, each marked with how it is billed, and the policy and quota they are judged by. */
  async function availability(plan?: string) {
    const catalog = await discoverWorkModels(ctx.llm);
    const projectPolicy = projectModelPolicy(
      plan ? records.read(plan).document : { records: [] },
    );
    const capacity = await readSubscriptionCapacity(
      ctx.get?.("connection"),
      [...new Set(catalog.models.map((m) => m.provider))],
      isSubscriptionOnlyMode(projectPolicy.mode),
    );
    const configured = ctx.llm.listConfigurableProviders?.() ?? [];
    for (const model of catalog.models) {
      const subscription = capacity.providers.some(
        (p: any) => p.provider === model.provider && p.subscription,
      );
      const route = configured.find(
        (p: any) => p.provider === model.provider && !p.error,
      );
      model.billing = subscription
        ? "subscription"
        : ["llm-deepseek", "llm-pi-ai"].includes(route?.settingsNs)
          ? "api"
          : "unknown";
    }
    return { ...catalog, projectPolicy, capacity };
  }

  /** Everything the owner's model views and the planner's model choice need. */
  async function capabilities(actor?: Actor) {
    const available = await availability(actor?.plan);
    const { models, projectPolicy, capacity } = available;
    const subscriptionOnly = isSubscriptionOnlyMode(projectPolicy.mode);
    const deepSeekPricing = options.pricing?.read();
    const unsubscribed = [...new Set(models.map((m) => m.provider))].filter(
      (provider) =>
        !capacity.providers.some(
          (s: any) => s.provider === provider && s.subscription,
        ),
    );
    const apiBalances = await readApiBalances(
      ctx,
      subscriptionOnly ? [] : unsubscribed,
    );
    const policyCandidates = models.map((m) => ({
      model: `${m.provider}/${m.id}`,
      ...policyEligibility(m.provider, m.id, projectPolicy, capacity),
    }));
    const planningModels = models.filter(
      (m, i) =>
        m.metadata === "resolved" &&
        policyCandidates[i].eligible &&
        !billingEligibility(projectPolicy, m.billing),
    );
    return {
      ...available,
      deepSeekPricing,
      referencePrices: modelReferencePrices(ctx, models),
      settingsLocked: actor ? !!options.building?.(actor.plan) : false,
      modes: modelModes,
      apiBalances,
      policyCandidates,
      planningModels,
      ...(subscriptionOnly
        ? {
            quotaPlanning: {
              models: planningModels.map((m) => ({
                model: `${m.provider}/${m.id}`,
                ...quotaContext(m.provider, m.id, projectPolicy, capacity),
              })),
              scope:
                "Planning advice. A shared provider window is one budget for the planner and every session of a build. A window at 0% remaining does not make a model ineligible: the account's usage credits can keep it answering.",
            },
          }
        : {}),
    };
  }

  return {
    capabilities,

    /** Every model DSH offers, as the provider and model ids a subagent is started on. */
    async routes() {
      const { models } = await discoverWorkModels(ctx.llm);
      const routes = new Map<string, { provider: string; model: string }>();
      for (const m of models) routes.set(`${m.provider}/${m.id}`, { provider: m.provider, model: m.id });
      return [...routes.values()];
    },

    /** Agent options for a planned model and thinking level, after policy and price checks. */
    async route(actor: Actor, model: string, thinking: string) {
      const selected = routeModel(
        { model, thinking },
        await availability(actor.plan),
      );
      options.pricing?.assertAllowed(selected.provider, selected.model);
      return selected;
    },

    /**
     * The owner's and planner's questions about models: the catalog
     * ("capabilities") and recorded usage ("usage"). The planner reads the
     * catalog in bounded pages; the owner's views get it whole.
     */
    async query(actor: Actor, command: unknown) {
      const action = (command as any)?.action;
      if (action === "usage")
        return usageQuery(records.store.usage, actor, command);
      if (action !== "capabilities")
        throw new PlanError(
          "INVALID",
          'Ask for models with {action: "capabilities"} or recorded usage with {action: "usage"}',
        );
      if (actor.role !== "planner") return capabilities(actor);
      // A malformed page request is refused before any provider is asked.
      const query = capabilityQuery(command);
      return planningCapabilities(await capabilities(actor), query);
    },
  };
}

export type ModelServices = ReturnType<typeof modelServices>;

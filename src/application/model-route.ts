import { PlanError } from "../domain/plan.ts";
import { billingEligibility } from "../domain/model-ladder.ts";
import {
  isSubscriptionOnlyMode,
  quotaContext,
} from "../domain/subscription-quota.ts";
import {
  defaultModelPolicy,
  policyEligibility,
} from "../domain/model-policy.ts";

/** A model and thinking level as the plan names them: "provider/model" and an effort ID. */
export type ModelChoice = { model: string; thinking: string };

/**
 * The agent options for a planned model, after checking that DSH offers the
 * model and thinking level and that the owner's model policy allows it: its
 * provider, its billing (subscription or API) and, in subscription-only
 * mode, a subscription plan that is still in force.
 */
export function routeModel(choice: ModelChoice, available: any) {
  const [provider, ...rest] = choice.model.split("/");
  const model = rest.join("/");
  const offered = available.models.find(
    (m: any) => m.provider === provider && m.id === model,
  );
  const efforts = offered?.reasoning?.efforts ?? [];
  const thinkingOffered = efforts.length
    ? efforts.some((effort: any) => effort.id === choice.thinking)
    : choice.thinking === "default";
  if (!offered || offered.metadata === "unresolved" || !thinkingOffered)
    throw new PlanError(
      "UNAVAILABLE",
      `DSH does not offer ${choice.model} with thinking "${choice.thinking}". Choose an available model in chat.`,
    );
  const policy = available.projectPolicy ?? defaultModelPolicy;
  const eligible = policyEligibility(
    provider,
    model,
    policy,
    available.capacity,
  );
  if (!eligible.eligible) throw new PlanError("UNAVAILABLE", eligible.reason);
  const billing =
    offered.billing ??
    (available.capacity?.providers?.some(
      (p: any) => p.provider === provider && p.subscription,
    )
      ? "subscription"
      : "unknown");
  const billingBlock = billingEligibility(policy, billing);
  if (billingBlock) throw new PlanError("UNAVAILABLE", billingBlock);
  if (
    isSubscriptionOnlyMode(policy.mode) &&
    quotaContext(provider, model, policy, available.capacity).planConflict
  )
    throw new PlanError(
      "UNAVAILABLE",
      "The subscription plan for this model has changed. Review the model choice before building.",
    );
  return {
    provider,
    model,
    ...(efforts.length ? { reasoningEffort: choice.thinking } : {}),
    ...(offered.defaultMaxTokens
      ? { maxTokens: Math.min(32768, offered.defaultMaxTokens) }
      : {}),
  };
}

import { isSubscriptionOnlyMode } from "./subscription-quota.ts";

export const costMode = "cost-ladder";
export const costModeLabel = "Lowest cost first";

export function billingEligibility(policy: any, billing: string | undefined) {
  if (isSubscriptionOnlyMode(policy.mode))
    return billing === "subscription"
      ? undefined
      : "Subscription quota mode permits subscription routes only; API and unknown billing routes are excluded";
  if (policy.mode !== costMode) return undefined;
  if (
    billing === "subscription" ||
    (policy.allowApi === true && billing === "api")
  )
    return undefined;
  return billing === "api"
    ? "Allow API is off. Choose a subscription route or change this mode's preference."
    : "This route's API/subscription billing type is unknown. It cannot join the price-ordered mode yet.";
}

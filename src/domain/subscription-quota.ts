import { object, PlanError, text } from "./plan.ts";

export const quotaMode = "subscription-quota";
export const quotaModeLabel = "Use subscription quota";
export const qualityMode = "quality-first";
export const isSubscriptionOnlyMode = (mode: unknown) =>
  mode === quotaMode || mode === qualityMode;
const required = (value: unknown, name: string) => {
  const result = text(value, name, 2000).trim();
  if (!result) throw new PlanError("INVALID", `${name} is required`);
  return result;
};

// Owner context supplements telemetry; it never overwrites a reported plan.
export function subscriptionPlans(value: unknown) {
  if (!Array.isArray(value) || value.length > 100)
    throw new PlanError("INVALID", "Expected subscription plan details");
  const plans = value.map((v) => {
    const p = object(v, ["provider", "plan", "allowance"]);
    return {
      provider: required(p.provider, "provider"),
      plan: required(p.plan, "plan name"),
      allowance: required(p.allowance, "allowance details"),
    };
  });
  if (new Set(plans.map((p) => p.provider)).size !== plans.length)
    throw new PlanError("INVALID", "Duplicate subscription plan");
  return plans;
}

export function quotaContext(
  provider: string,
  model: string,
  policy: any,
  capacity: any,
  now = Date.now(),
) {
  const p = capacity?.providers?.find((p: any) => p.provider === provider);
  const owner = policy.subscriptionPlans?.find(
    (p: any) => p.provider === provider,
  );
  const windows = (p?.windows ?? []).filter(
    (w: any) => !w.scope || w.scope === model,
  );
  return {
    plan: p?.plan ?? owner?.plan ?? null,
    planSource: p?.plan ? p.planSource : owner ? "owner" : "unknown",
    ownerContext: owner ?? null,
    planConflict: !!(p?.plan && owner && p.plan !== owner.plan),
    windows: windows.map((w: any) => ({
      ...w,
      hoursUntilReset:
        Number.isFinite(w.resetsAt) && w.resetsAt > now
          ? (w.resetsAt - now) / 3600000
          : null,
    })),
    allowance:
      "Percentages are provider-local. Absolute allowance and task consumption are not reported by this adapter; use dated plan evidence or measured comparable work, never subscription price as a multiplier.",
  };
}

import { object, text, PlanError } from "./plan.ts";
import { costMode } from "./model-ladder.ts";
import {
  quotaMode,
  qualityMode,
  isSubscriptionOnlyMode,
  subscriptionPlans,
} from "./subscription-quota.ts";

export const modelModes = {
  [qualityMode]:
    "Subscription models only. Prefer the most capable suitable models with higher supported thinking, while respecting exclusions, reserves and sustainable quota pacing.",
  [quotaMode]:
    "Subscription models only. Match task and thinking level to plan allowance, remaining quota and reset times; favor suitable capacity that would otherwise expire sooner.",
  [costMode]:
    "Build with the lowest-priced model suited to the project. Subscription routes only unless Allow API is enabled.",
};
/** A plan that has not chosen a model mode yet. */
export const noMode = "not-chosen";
export const defaultModelPolicy = {
  mode: noMode,
  preferredProviders: [] as string[],
  excludedProviders: [] as string[],
  reserves: [] as { provider: string; percent: number }[],
};

export function modelPolicy(value: unknown) {
  if (value === undefined) return undefined;
  const q = object(value, [
    "mode",
    "preferredProviders",
    "excludedProviders",
    "excludedModels",
    "reserves",
    "allowApi",
    "subscriptionPlans",
  ]);
  if (
    typeof q.mode !== "string" ||
    !(Object.hasOwn(modelModes, q.mode) || q.mode === noMode)
  )
    throw new PlanError("INVALID", "Unknown project model mode");
  if (
    q.allowApi !== undefined &&
    (q.mode !== costMode || typeof q.allowApi !== "boolean")
  )
    throw new PlanError(
      "INVALID",
      "Allow API is a boolean preference for Lowest cost first",
    );
  const names = (v: unknown) => {
    if (!Array.isArray(v) || v.length > 100)
      throw new PlanError("INVALID", "Expected provider list");
    const out = v.map((x) => text(x, "provider", 200).trim());
    if (out.some((x) => !x) || new Set(out).size !== out.length)
      throw new PlanError(
        "INVALID",
        "Provider names must be distinct and nonempty",
      );
    return out;
  };
  const preferredProviders = names(q.preferredProviders),
    excludedProviders = names(q.excludedProviders);
  let excludedModels: string[] | undefined;
  if (q.excludedModels !== undefined) {
    if (!Array.isArray(q.excludedModels) || q.excludedModels.length > 1000)
      throw new PlanError(
        "INVALID",
        "Expected a list of excluded model routes",
      );
    excludedModels = q.excludedModels.map((v) =>
      text(v, "model route", 400).trim(),
    );
    if (
      excludedModels.some((v) => !/^[^/\s]+\/[^\s]+$/.test(v)) ||
      new Set(excludedModels).size !== excludedModels.length
    )
      throw new PlanError(
        "INVALID",
        "Excluded models need distinct provider/model routes",
      );
  }
  if (preferredProviders.some((p) => excludedProviders.includes(p)))
    throw new PlanError(
      "INVALID",
      "A provider cannot be preferred and excluded",
    );
  if (!Array.isArray(q.reserves) || q.reserves.length > 100)
    throw new PlanError("INVALID", "Expected quota reserve list");
  const reserves = q.reserves.map((v) => {
    const r = object(v, ["provider", "percent"]),
      provider = text(r.provider, "provider", 200).trim();
    if (
      !provider ||
      typeof r.percent !== "number" ||
      !Number.isFinite(r.percent) ||
      r.percent < 0 ||
      r.percent > 100
    )
      throw new PlanError(
        "INVALID",
        "Reserve percent must be between 0 and 100",
      );
    return { provider, percent: r.percent };
  });
  if (new Set(reserves.map((r) => r.provider)).size !== reserves.length)
    throw new PlanError("INVALID", "Duplicate provider reserve");
  return {
    mode: q.mode,
    preferredProviders,
    excludedProviders,
    ...(excludedModels === undefined ? {} : { excludedModels }),
    reserves,
    ...(q.subscriptionPlans === undefined
      ? {}
      : { subscriptionPlans: subscriptionPlans(q.subscriptionPlans) }),
    ...(q.mode === costMode ? { allowApi: q.allowApi === true } : {}),
  };
}

export function projectModelPolicy(document: any) {
  const policies = document.records.filter(
    (r: any) =>
      r.kind === "decision" && r.status !== "superseded" && r.data.modelPolicy,
  );
  if (policies.length > 1)
    throw new PlanError("INVALID", "Keep one active project model policy");
  return policies[0]?.data.modelPolicy ?? defaultModelPolicy;
}

export function routeCapacity(
  provider: string,
  model: string,
  capacity: any,
  now = Date.now(),
) {
  const p = capacity?.providers?.find((p: any) => p.provider === provider);
  // Snapshot expires locally; upstream measurement can still be older than retrieval.
  if (
    p?.status !== "reported" ||
    !Number.isFinite(Date.parse(capacity.retrievedAt)) ||
    now - Date.parse(capacity.retrievedAt) > 300000 ||
    Date.parse(capacity.retrievedAt) > now + 1000
  )
    return { status: "unknown", remainingPercent: null };
  const windows = p.windows.filter(
    (w: any) =>
      (!w.scope || w.scope === model) &&
      typeof w.remainingPercent === "number" &&
      Number.isFinite(w.remainingPercent) &&
      w.remainingPercent >= 0 &&
      w.remainingPercent <= 100,
  );
  if (
    p.windows.some((w: any) => w.scope) &&
    !p.windows.some((w: any) => w.scope === model)
  )
    return { status: "unknown", remainingPercent: null };
  if (
    !windows.length ||
    windows.some((w: any) => w.resetsAt !== undefined && w.resetsAt <= now)
  )
    return { status: "unknown", remainingPercent: null };
  return {
    status: "reported",
    remainingPercent: Math.min(...windows.map((w: any) => w.remainingPercent)),
  };
}

export function policyEligibility(
  provider: string,
  model: string,
  policy: any,
  capacity: any,
  now = Date.now(),
) {
  if (policy.excludedModels?.includes(`${provider}/${model}`))
    return {
      eligible: false,
      reason:
        "Model disabled for this project. Enable it in model settings before selecting it.",
    };
  if (policy.excludedProviders.includes(provider))
    return {
      eligible: false,
      reason: "Provider excluded by this project's model policy",
    };
  const quota = routeCapacity(provider, model, capacity, now),
    reserve = policy.reserves.find((r: any) => r.provider === provider);
  if (
    isSubscriptionOnlyMode(policy.mode) &&
    (quota.remainingPercent === null ||
      !capacity?.providers
        ?.find((p: any) => p.provider === provider)
        ?.windows?.filter((w: any) => !w.scope || w.scope === model)
        .every(
          (w: any) =>
            Number.isFinite(w.remainingPercent) &&
            w.remainingPercent >= 0 &&
            w.remainingPercent <= 100 &&
            (w.resetsAt === undefined ||
              (Number.isFinite(w.resetsAt) && w.resetsAt > now)),
        ))
  )
    return {
      eligible: false,
      reason:
        "Subscription quota mode needs fresh applicable usage and valid reported reset times; refresh capacity or reassess the route",
    };
  if (reserve && quota.remainingPercent === null)
    return {
      eligible: false,
      reason:
        "Cannot check this project's quota reserve: current applicable usage is unknown",
    };
  // A reported 0% is not unavailability: an account's usage credits can keep a
  // subscription answering past its quota, so only the owner's reserve is a line.
  if (
    reserve &&
    quota.remainingPercent !== null &&
    quota.remainingPercent <= reserve.percent
  )
    return {
      eligible: false,
      reason:
        "Reported quota is at this project's reserve; review another suitable model",
    };
  return {
    eligible: true,
    reason: policy.preferredProviders.includes(provider)
      ? "Preferred provider, subject to task suitability"
      : "Subject to task suitability",
    ...quota,
  };
}

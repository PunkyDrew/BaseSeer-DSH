import { PlanError, object, text } from "../domain/plan.ts";
import {
  defaultModelPolicy,
  policyEligibility,
} from "../domain/model-policy.ts";
import { billingEligibility } from "../domain/model-ladder.ts";
import {
  quotaContext,
  isSubscriptionOnlyMode,
} from "../domain/subscription-quota.ts";

export const CAPABILITY_PAGE_BYTES = 28_000;
export function capabilityQuery(value: unknown) {
  const q = object(value, [
    "action",
    "provider",
    "model",
    "id",
    "offset",
    "limit",
  ]);
  if (q.action !== "capabilities")
    throw new PlanError("INVALID", "Expected capabilities action");
  const field = (key: string) =>
    q[key] === undefined ? undefined : text(q[key], key, 400).trim();
  const provider = field("provider"),
    model = field("model"),
    id = field("id");
  if ([provider, model, id].some((v) => v === ""))
    throw new PlanError("INVALID", "Catalog filters must not be empty");
  if (id && (provider || model))
    throw new PlanError(
      "INVALID",
      "Use provider/model filters or id, not both",
    );
  const offset = q.offset ?? 0,
    limit = q.limit ?? 8;
  if (
    !Number.isSafeInteger(offset) ||
    (offset as number) < 0 ||
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 20
  )
    throw new PlanError(
      "INVALID",
      "Catalog offset must be nonnegative and limit must be 1–20",
    );
  return {
    provider,
    model,
    id,
    offset: offset as number,
    limit: limit as number,
  };
}

/** Planner-only bounded projection. Full catalogs remain internal to validation
 * and owner UI; paging is never used as the source of dispatch eligibility. */
export function planningCapabilities(
  available: any,
  query: ReturnType<typeof capabilityQuery>,
) {
  const policy = available.projectPolicy ?? defaultModelPolicy;
  const all = [...available.models].sort((a: any, b: any) =>
    `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`),
  );
  const matching = all.filter(
    (m: any) =>
      (!query.provider || m.provider === query.provider) &&
      (!query.model ||
        m.id === query.model ||
        `${m.provider}/${m.id}` === query.model) &&
      (!query.id ||
        m.provider === query.id ||
        m.id === query.id ||
        `${m.provider}/${m.id}` === query.id),
  );
  const clip = (v: unknown, max = 800) =>
    typeof v === "string" ? v.slice(0, max) : null;
  const project = (m: any) => {
    const route = `${m.provider}/${m.id}`;
    const quota = quotaContext(m.provider, m.id, policy, available.capacity);
    const snapshot = available.capacity?.providers?.find(
      (p: any) => p.provider === m.provider,
    );
    const eligibility = policyEligibility(
      m.provider,
      m.id,
      policy,
      available.capacity,
    );
    const billing =
      m.billing ?? (snapshot?.subscription ? "subscription" : "unknown");
    const billingBlock = billingEligibility(policy, billing);
    const planBlock =
      isSubscriptionOnlyMode(policy.mode) && quota.planConflict
        ? "Reported subscription plan conflicts with the owner's plan context; reassess before selecting this route"
        : null;
    const resolved = m.metadata === "resolved";
    return {
      route,
      provider: m.provider,
      id: m.id,
      name: clip(m.name, 200),
      description: clip(m.description, 600),
      descriptionTruncated:
        typeof m.description === "string" && m.description.length > 600,
      metadata: m.metadata,
      billing,
      referencePrice: available.referencePrices?.[route] ?? null,
      // Exact identifiers must never be clipped: an oversized single item fails
      // explicitly instead of recommending a fabricated route or thinking ID.
      thinkingChoices: m.thinkingChoices ?? [],
      defaultThinking: m.defaultThinking ?? null,
      eligibility: {
        eligible:
          resolved && eligibility.eligible && !billingBlock && !planBlock,
        reason: !resolved
          ? "Model metadata is unresolved"
          : (billingBlock ?? planBlock ?? eligibility.reason ?? null),
      },
    };
  };
  const models: any[] = [];
  const response = () => ({
    models,
    page: {
      offset: query.offset,
      returned: models.length,
      total: matching.length,
      nextOffset:
        query.offset + models.length < matching.length
          ? query.offset + models.length
          : null,
      limit: query.limit,
      filters: {
        provider: query.provider ?? null,
        model: query.model ?? null,
        id: query.id ?? null,
      },
    },
    discovery: {
      observedAt: available.discovery?.observedAt ?? null,
      complete: available.discovery?.complete ?? false,
      issueCount: available.discovery?.issues?.length ?? 0,
      issues: (available.discovery?.issues ?? [])
        .filter((i: any) => !query.provider || i.provider === query.provider)
        .slice(0, 8)
        .map((i: any) => ({
          provider: clip(i.provider, 400),
          model: clip(i.model, 400),
          stage: clip(i.stage, 50),
          message: clip(i.message),
        })),
    },
    policy: { mode: policy.mode },
    priceGuidance:
      "When present, referencePrice.apiPrice gives an endpoint-qualified dated price for comparing models, subscription routes included; it is not measured usage. A null referencePrice means no verified reference was supplied, not that the model is free or unavailable. Never invent missing prices.",
    instructions:
      "This is a bounded catalog page, not a partial tool spill. Use capabilities with provider:<exact provider>, model:<exact model ID or route>, offset:<nextOffset>, limit:1–20; id is an exact provider/model/route compatibility filter. Each model includes its billing, reference price and eligibility under the owner's policy; whether a build can start is BaseSeer's check at the go. Do not change the owner's model policy unless the owner asks for a standing change. Nothing in this catalog starts a build.",
  });
  for (const m of matching.slice(query.offset, query.offset + query.limit)) {
    models.push(project(m));
    if (
      Buffer.byteLength(JSON.stringify(response()), "utf8") >
      CAPABILITY_PAGE_BYTES
    ) {
      models.pop();
      if (!models.length)
        throw new PlanError(
          "INCOMPLETE",
          "One model's exact route metadata exceeds the safe catalog response bound. No fields were silently omitted; adapter metadata needs correction.",
        );
      break;
    }
  }
  const result = response();
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > CAPABILITY_PAGE_BYTES)
    throw new PlanError(
      "INCOMPLETE",
      "Catalog summary exceeds its safe output bound",
    );
  return result;
}

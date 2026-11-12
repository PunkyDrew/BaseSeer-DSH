import React from "react";
import { modelModes, projectModelPolicy } from "../domain/model-policy.ts";
import { costMode, costModeLabel } from "../domain/model-ladder.ts";
import { quotaMode, quotaModeLabel } from "../domain/subscription-quota.ts";

export function ProjectModelPolicy({
  records,
  routing,
}: {
  records: any[];
  routing: any;
}) {
  const policy = projectModelPolicy({ records });
  const labels: Record<string, string> = {
    [costMode]: costModeLabel,
    [quotaMode]: quotaModeLabel,
  };
  return (
    <div aria-label="Project model policy">
      <h3>
        Model priorities: {labels[policy.mode] ?? "No strategy chosen yet"}
      </h3>
      <p>
        {modelModes[policy.mode as keyof typeof modelModes] ??
          "Pick how agents should use your models in Agent strategy."}
      </p>
      {policy.mode === costMode && (
        <p>
          Allow API: {policy.allowApi ? "On" : "Off — subscription models only"}
          .
        </p>
      )}
      <p>
        Preferred providers:{" "}
        {policy.preferredProviders.join(", ") || "No preference"}. Excluded:{" "}
        {policy.excludedProviders.join(", ") || "None"}.
      </p>
      {!!policy.excludedModels?.length && (
        <p>Disabled models: {policy.excludedModels.join(", ")}.</p>
      )}
      {policy.reserves.map((r: any) => (
        <p key={r.provider}>
          Do not start new work on {r.provider} at or below {r.percent}%
          remaining. This checks admission, not the unknown consumption of a
          running task. Unknown usage requires review.
        </p>
      ))}
      <details>
        <summary>Project modes and current capacity</summary>
        <ul>
          {Object.entries(modelModes).map(([key, description]) => (
            <li key={key}>
              <strong>{labels[key]}:</strong> {description}
            </li>
          ))}
        </ul>
        <p>
          All modes avoid unnecessary model cost. Change priorities in Agent
          strategy; provider and model choices come from this installation.
        </p>
        {routing ? (
          <>
            <p>
              {routing.models.length} model routes discovered.{" "}
              {routing.discovery.complete
                ? "Catalog lookup completed."
                : "Some catalog lookups failed; availability is incomplete."}
            </p>
            <h4>Subscription quota</h4>
            <p>
              Quota retrieved: {routing.capacity.retrievedAt}.{" "}
              {routing.capacity.status === "available"
                ? "Provider data may be cached. Remaining percentages are not equivalent work budgets."
                : "Quota tracking requires the subscription plugin and a supported usage endpoint."}
            </p>
            <ul>
              {routing.capacity.providers
                .filter((p: any) => p.subscription)
                .map((p: any) => (
                  <li key={p.provider}>
                    <p>Plan: {p.plan ?? "Not reported"}</p>
                    {p.status !== "reported" ? (
                      `${p.provider}: quota unknown`
                    ) : (
                      <details>
                        <summary>
                          {p.provider}: {p.windows.length} reported quota{" "}
                          {p.windows.length === 1 ? "window" : "windows"}
                        </summary>
                        <ul>
                          {p.windows.map((w: any, i: number) => (
                            <li key={i}>
                              {w.scope ? `${w.scope} · ` : ""}
                              {w.kind}: {Number(w.remainingPercent.toFixed(1))}%
                              remaining
                              {w.resetsAt
                                ? `; resets ${new Date(w.resetsAt).toISOString()}`
                                : "; reset unknown"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
            </ul>
            <p className="bpv-muted">
              Usage covers default accounts only. No account quotas are
              combined.
            </p>
            <h4>API balances</h4>
            {routing.apiBalances ? (
              <>
                <p>Balances retrieved: {routing.apiBalances.retrievedAt}.</p>
                <ul>
                  {routing.apiBalances.providers.map((p: any) => (
                    <li key={p.provider}>
                      <strong>{p.provider}</strong>
                      {p.balances.length ? (
                        <ul>
                          {p.balances.map((b: any, i: number) => (
                            <li key={i}>
                              {b.kind === "key-allowance"
                                ? "Key allowance"
                                : "Account credit"}
                              : {b.currency}{" "}
                              {b.remaining.toLocaleString(undefined, {
                                maximumFractionDigits: 8,
                              })}{" "}
                              remaining
                              {b.reset ? `; resets ${b.reset}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Balance unavailable.</p>
                      )}
                      {p.available === false && (
                        <p>
                          The provider reports insufficient balance for API
                          calls.
                        </p>
                      )}
                      {p.reason && <p className="bpv-muted">{p.reason}</p>}
                      {p.limits && <p className="bpv-muted">{p.limits}</p>}
                    </li>
                  ))}
                </ul>
                {!routing.apiBalances.providers.length && (
                  <p>No separate API routes were discovered.</p>
                )}
                <p className="bpv-muted">
                  Balances depend on provider support and credential
                  permissions. Unknown is not zero. Currency balances, key
                  allowances and subscription percentages are separate; actual
                  task cost remains unmeasured.
                </p>
              </>
            ) : (
              <p>API balances have not been read in this view.</p>
            )}
          </>
        ) : (
          <p>
            Model availability, quota and API balances have not been read in
            this view.
          </p>
        )}
      </details>
    </div>
  );
}

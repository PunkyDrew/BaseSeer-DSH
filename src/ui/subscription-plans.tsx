import React from "react";

export function SubscriptionPlans({
  catalog,
  policy,
  disabled,
  onChange,
}: {
  catalog: any;
  policy: any;
  disabled: boolean;
  onChange: (plans: any[]) => void;
}) {
  const providers = [
    ...new Set<string>([
      ...(catalog.capacity?.providers ?? [])
        .filter((p: any) => p.subscription)
        .map((p: any) => p.provider),
      ...(policy.subscriptionPlans ?? []).map((p: any) => p.provider),
    ]),
  ];
  return (
    <details open>
      <summary>Subscription plans and allowances</summary>
      <p>
        Detected plans and quota windows go to the planner automatically. Add
        details only when a plan is missing or its allowance needs explanation.
        A subscription’s price is not a measure of how much work it can do.
      </p>
      {!providers.length && (
        <p>
          No subscription accounts reported. Connect a subscription in Settings,
          then reload model settings.
        </p>
      )}
      {providers.map((provider) => {
        const reported = catalog.capacity?.providers?.find(
          (p: any) => p.provider === provider,
        );
        const entry = policy.subscriptionPlans?.find(
          (p: any) => p.provider === provider,
        );
        const change = (part: any) =>
          onChange(
            (policy.subscriptionPlans ?? [])
              .filter((p: any) => p.provider !== provider)
              .concat({
                provider,
                plan: entry?.plan ?? reported?.plan ?? "",
                allowance: entry?.allowance ?? "",
                ...part,
              }),
          );
        return (
          <fieldset
            key={provider}
            disabled={disabled}
            className="bpv-settings-group"
          >
            <legend>{provider}</legend>
            <p>
              Detected plan: {reported?.plan ?? "Not reported"}.{" "}
              {reported?.status !== "reported"
                ? "Quota unavailable."
                : reported.windows
                    .map(
                      (w: any) =>
                        `${w.scope ? w.scope + " · " : ""}${w.kind}: ${Number(w.remainingPercent.toFixed(1))}% remaining; ${w.resetsAt ? "resets " + new Date(w.resetsAt).toLocaleString() : "reset unknown"}`,
                    )
                    .join(". ")}
            </p>
            <label className="bpv-setting-toggle">
              <input
                type="checkbox"
                checked={!!entry}
                onChange={(e) =>
                  e.target.checked
                    ? change({})
                    : onChange(
                        policy.subscriptionPlans.filter(
                          (p: any) => p.provider !== provider,
                        ),
                      )
                }
              />{" "}
              Add plan details for the planner
            </label>
            {entry && (
              <>
                <label className="bpv-setting-field">
                  {provider} plan name
                  <input
                    maxLength={2000}
                    value={entry.plan}
                    onChange={(e) => change({ plan: e.target.value })}
                  />
                </label>
                <label className="bpv-setting-field">
                  {provider} allowance details
                  <textarea
                    maxLength={2000}
                    value={entry.allowance}
                    onChange={(e) => change({ allowance: e.target.value })}
                    placeholder="Included allowance, model limits or observed usage; include a date/source if known."
                  />
                </label>
                {reported?.plan && reported.plan !== entry.plan && (
                  <p role="status">
                    Your plan name differs from the detected plan. The planner
                    will see both; estimates need reassessment.
                  </p>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      <p className="bpv-muted">
        This mode refreshes quota before dispatch. Missing or expired quota and
        unknown reset times need reassessment. Saving does not start work.
      </p>
    </details>
  );
}

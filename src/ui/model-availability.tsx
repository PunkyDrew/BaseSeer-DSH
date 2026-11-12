import React from "react";
import { modelThinking } from "../domain/model-thinking.ts";
import { billingEligibility } from "../domain/model-ladder.ts";

export function ModelAvailability({
  models,
  policy,
  disabled,
  onChange,
}: {
  models: any[];
  policy: any;
  disabled: boolean;
  onChange: (excluded: string[]) => void;
}) {
  const excluded: string[] = policy.excludedModels ?? [];
  const missing = excluded.filter(
    (route) => !models.some((m) => `${m.provider}/${m.id}` === route),
  );
  const toggle = (route: string, enabled: boolean) =>
    onChange(
      enabled ? excluded.filter((r) => r !== route) : [...excluded, route],
    );
  return (
    <details className="bpv-model-availability">
      <summary>
        Models available for this project · {excluded.length} disabled
      </summary>
      <p>
        Uncheck a model to keep it out of this project's builds and the
        planner's choices. The planner chooses a supported thinking level for
        each enabled model based on the task.
      </p>
      <p className="bpv-muted">
        Model names such as Pro or Flash do not determine suitability. Chat
        model selection remains in the chat controls.
      </p>
      {[...new Set(models.map((m) => m.provider))].map((provider) => (
        <fieldset className="bpv-settings-group" key={provider}>
          <legend>{provider}</legend>
          {models
            .filter((m) => m.provider === provider)
            .map((m) => {
              const route = `${m.provider}/${m.id}`;
              const options =
                m.metadata === "resolved" ? modelThinking(m).options : [];
              return (
                <div key={route}>
                  <label className="bpv-setting-toggle">
                    <input
                      type="checkbox"
                      checked={!excluded.includes(route)}
                      disabled={disabled}
                      aria-label={`Allow ${m.name ?? m.id} (${provider}/${m.id})`}
                      onChange={(e) => toggle(route, e.target.checked)}
                    />
                    <span>
                      {m.name ?? m.id} <small>({m.id})</small>
                    </span>
                  </label>
                  <p className="bpv-muted">
                    {options.length
                      ? `Thinking levels: ${options.map((o) => o.name).join(", ")}`
                      : "Model metadata is unavailable; it cannot be selected yet."}
                    {policy.excludedProviders.includes(provider)
                      ? " Provider excluded by project preferences."
                      : ""}
                    {billingEligibility(policy, m.billing)
                      ? " Unavailable under this mode’s billing preference."
                      : ""}
                  </p>
                </div>
              );
            })}
        </fieldset>
      ))}
      {!!missing.length && (
        <fieldset className="bpv-settings-group">
          <legend>Saved exclusions outside the current catalog</legend>
          {missing.map((route) => (
            <label className="bpv-setting-toggle" key={route}>
              <input
                type="checkbox"
                checked
                disabled={disabled}
                onChange={() => toggle(route, true)}
              />{" "}
              Keep excluding {route}
            </label>
          ))}
        </fieldset>
      )}
    </details>
  );
}

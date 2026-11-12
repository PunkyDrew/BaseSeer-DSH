import React, { useState } from "react";
import { modelModes, projectModelPolicy } from "../domain/model-policy.ts";
import { PricingStatus } from "./provider-pricing.tsx";
import { costMode } from "../domain/model-ladder.ts";
import { ModelAvailability } from "./model-availability.tsx";
import { quotaMode } from "../domain/subscription-quota.ts";
import { SubscriptionPlans } from "./subscription-plans.tsx";
import { strategyPresets } from "./agent-strategy.ts";

export function ProjectModelSettings({
  call,
  sessionId,
  records,
  onSaved,
}: {
  call: (op: string, payload: any) => Promise<any>;
  sessionId: string;
  records: any[];
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<any>(null),
    [catalog, setCatalog] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [savedRevision, setSavedRevision] = useState<number | null>(null),
    [advancedOpen, setAdvancedOpen] = useState(false),
    [pendingMode, setPendingMode] = useState<string | null>(null);
  const load = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const [plan, available] = await Promise.all([
        call("session-design", { session: sessionId, command: { op: "read" } }),
        call("session-models", {
          session: sessionId,
          command: { action: "capabilities" },
        }),
      ]);
      const policy = projectModelPolicy(plan.document);
      setCatalog(available);
      setDraft({
        expected: plan.revision,
        policy: {
          ...policy,
          mode: Object.hasOwn(modelModes, policy.mode) ? policy.mode : costMode,
          excludedModels: policy.excludedModels ?? [],
          ...(policy.mode !== costMode
            ? {}
            : {
                allowApi: policy.allowApi === true,
              }),
        },
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const needsStrategy = !Object.hasOwn(
    modelModes,
    projectModelPolicy({ records }).mode,
  );
  const chooseStrategy = async (mode: string) => {
    setPendingMode(mode);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const plan = await call("session-design", {
        session: sessionId,
        command: { op: "read" },
      });
      const { allowApi: _, ...policy } = projectModelPolicy(plan.document);
      await call("session-model-settings", {
        session: sessionId,
        command: {
          expected: plan.revision,
          policy: {
            ...policy,
            mode,
            ...(mode === costMode ? { allowApi: false } : {}),
          },
        },
      });
      setDraft(null);
      setAdvancedOpen(false);
      setSavedRevision(plan.revision + 1);
      setMessage("Saved");
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const undoStrategy = async () => {
    if (savedRevision === null) return;
    setBusy(true);
    setError("");
    try {
      await call("session-undo", {
        session: sessionId,
        key: crypto.randomUUID(),
        command: { expected: savedRevision },
      });
      setSavedRevision(null);
      setMessage("Undone");
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await call("session-model-settings", {
        session: sessionId,
        command: {
          expected: draft.expected,
          policy: draft.policy,
        },
      });
      setDraft(null);
      setMessage(
        "Model settings saved. The next build uses them.",
      );
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bpv-model-settings" aria-label="Model usage settings">
      {needsStrategy && (
        <p className="bpv-muted">Choose a strategy to start building.</p>
      )}
      <fieldset
        className="bpv-strategy-presets"
        role="radiogroup"
        aria-label="Strategy"
        disabled={busy}
      >
        <legend>Strategy</legend>
        {strategyPresets.map(({ mode, name, description, recommended }) => (
          <label className="bpv-strategy-card" key={mode}>
            <input
              type="radio"
              aria-label={recommended ? `${name} (Recommended)` : name}
              name="agent-strategy"
              value={mode}
              checked={
                (busy && pendingMode
                  ? pendingMode
                  : projectModelPolicy({ records }).mode) === mode
              }
              onChange={() => void chooseStrategy(mode)}
            />
            <span>
              <strong>{name}</strong>
              {recommended && <small>Recommended</small>}
              <span className="bpv-muted">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {message && (
        <p role="status">
          {message}
          {savedRevision !== null && (
            <>
              {" "}
              ·{" "}
              <button disabled={busy} onClick={() => void undoStrategy()}>
                Undo
              </button>
            </>
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <details
        className="bpv-strategy-advanced"
        open={advancedOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setAdvancedOpen(open);
          if (open && !draft && !busy) void load();
        }}
      >
        <summary>Advanced</summary>
        {busy && !draft && <p role="status">Loading settings…</p>}
        {!busy && !draft && (
          <button onClick={() => void load()}>Load settings</button>
        )}
        {draft && (
          <>
            {catalog.settingsLocked && (
              <p role="status">
                A build is running. Let it finish or stop it before saving a new
                model configuration. Your selections below are only a preview.
              </p>
            )}
            <label className="bpv-setting-toggle">
              <input
                type="checkbox"
                disabled={busy || draft.policy.mode !== costMode}
                checked={
                  draft.policy.mode === costMode &&
                  draft.policy.allowApi === true
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    policy: { ...draft.policy, allowApi: e.target.checked },
                  })
                }
              />{" "}
              Allow paid API when cheaper
            </label>
            {draft.policy.mode !== costMode && (
              <p className="bpv-muted">Available with Save quota only.</p>
            )}
            {draft.policy.mode === costMode && (
              <>
                <p className="bpv-muted">
                  When enabled, the planner can choose API models as well as
                  subscription models. API calls use your configured API
                  billing. Saving settings does not start a build.
                </p>
              </>
            )}
            {(draft.policy.mode === quotaMode ||
              draft.policy.mode === "quality-first") && (
              <SubscriptionPlans
                catalog={catalog}
                policy={draft.policy}
                disabled={busy}
                onChange={(subscriptionPlans) =>
                  setDraft({
                    ...draft,
                    policy: { ...draft.policy, subscriptionPlans },
                  })
                }
              />
            )}
            <ModelAvailability
              models={catalog.models}
              policy={draft.policy}
              disabled={busy}
              onChange={(excludedModels) =>
                setDraft({
                  ...draft,
                  policy: { ...draft.policy, excludedModels },
                })
              }
            />
            <details>
              <summary>Provider preferences and quota reserves</summary>
              {[
                ...new Set<string>(catalog.models.map((m: any) => m.provider)),
              ].map((provider) => {
                const p = draft.policy;
                const preference = p.excludedProviders.includes(provider)
                  ? "excluded"
                  : p.preferredProviders.includes(provider)
                    ? "preferred"
                    : "neutral";
                const quota = catalog.capacity?.providers.find(
                  (c: any) => c.provider === provider && c.subscription,
                );
                return (
                  <div key={provider} className="bpv-provider-preference">
                    <label className="bpv-setting-field">
                      {provider}
                      <select
                        disabled={busy}
                        value={preference}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            policy: {
                              ...p,
                              preferredProviders: p.preferredProviders
                                .filter((v: string) => v !== provider)
                                .concat(
                                  e.target.value === "preferred"
                                    ? [provider]
                                    : [],
                                ),
                              excludedProviders: p.excludedProviders
                                .filter((v: string) => v !== provider)
                                .concat(
                                  e.target.value === "excluded"
                                    ? [provider]
                                    : [],
                                ),
                            },
                          })
                        }
                      >
                        <option value="neutral">No preference</option>
                        <option value="preferred">Prefer</option>
                        <option value="excluded">Exclude</option>
                      </select>
                    </label>
                    {quota && (
                      <label className="bpv-setting-field">
                        Keep quota reserve (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          placeholder="No reserve"
                          value={
                            p.reserves.find((r: any) => r.provider === provider)
                              ?.percent ?? ""
                          }
                          disabled={busy}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              policy: {
                                ...p,
                                reserves: p.reserves
                                  .filter((r: any) => r.provider !== provider)
                                  .concat(
                                    e.target.value === ""
                                      ? []
                                      : [
                                          {
                                            provider,
                                            percent: Number(e.target.value),
                                          },
                                        ],
                                  ),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </details>
            <div className="bpv-work-actions">
              <button
                className="bpv-primary"
                disabled={busy || catalog.settingsLocked}
                onClick={() => void save()}
              >
                Save model settings
              </button>
              <button disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
            <p className="bpv-muted">
              Saving updates the shared plan and its Undo history. It does not
              start a build.
            </p>
            {draft.policy.mode === costMode && catalog.deepSeekPricing && (
              <>
                <h3>DeepSeek API pricing</h3>
                <PricingStatus value={catalog.deepSeekPricing} />
                <p>
                  Change the peak-hours block in Settings → Models, beside the
                  DeepSeek API key.
                </p>
              </>
            )}
          </>
        )}
      </details>
    </section>
  );
}

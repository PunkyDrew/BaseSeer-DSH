import React, { useState } from "react";
import type { PlanningRecord } from "../domain/records.ts";
import { BuildPanel } from "./build-panel.tsx";
import { WorkUsage } from "./work-usage.tsx";
import { ProjectModelPolicy } from "./project-model-policy.tsx";
import { ProjectModelSettings } from "./model-settings.tsx";

/** The Build page: the planned build and its progress, its recorded usage and, behind one fold, the strategy its models follow and the project's models. */
export function BuildView({
  active = true,
  call,
  sessionId,
  records,
  changeVersion = 0,
  onSaved,
}: {
  active?: boolean;
  call: (op: string, payload: unknown) => Promise<any>;
  sessionId: string;
  records: PlanningRecord[];
  changeVersion?: number;
  onSaved: () => void | Promise<void>;
}) {
  const [routing, setRouting] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshRouting = async () => {
    setBusy(true);
    setError("");
    try {
      setRouting(
        await call("session-models", {
          session: sessionId,
          command: { action: "capabilities" },
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Build" className="bpv-group">
      <BuildPanel
        call={call}
        sessionId={sessionId}
        active={active}
        changeVersion={changeVersion}
      />
      <h2>Usage</h2>
      <WorkUsage active={active} sessionId={sessionId} call={call} />
      <details className="bpv-work-settings">
        <summary>Settings</summary>
        <h2>Strategy</h2>
        <ProjectModelSettings
          call={call}
          sessionId={sessionId}
          records={records}
          onSaved={onSaved}
        />
        <h2>Models and quota</h2>
        <ProjectModelPolicy records={records} routing={routing} />
        <button disabled={busy} onClick={() => void refreshRouting()}>
          Refresh models, quota and balances
        </button>
        {error && (
          <p role="alert" className="bpv-error">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}

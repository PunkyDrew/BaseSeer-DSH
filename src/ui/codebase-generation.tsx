import React, { useState } from "react";
import type { Generation } from "../contracts/generation.ts";

export function CodebaseGenerationPanel({
  call,
  sessionId,
  state,
  onChanged,
  onCode,
  onPlanning,
  onSection,
  onChat,
}: {
  call: (op: string, payload?: unknown) => Promise<any>;
  sessionId: string;
  state: any;
  onChanged: () => Promise<void>;
  onCode: () => void;
  onPlanning: () => void;
  onSection: (section: string) => void;
  onChat: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run:
    | (Generation & {
        progress?: { phase: string; files: number; visited: number };
      })
    | null = state.ingestion;
  const active =
    !!run && ["scanning", "generating", "stopping"].includes(run.status);
  const stop = async () => {
    if (!run || !active || run.session !== sessionId) return;
    setBusy(true);
    setError("");
    try {
      await call("session-ingestion", {
        session: sessionId,
        command: { action: "cancel", id: run.id },
      });
      await onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bpv-group" aria-label="Generation status and coverage">
      <h2>Generation status and coverage</h2>
      <p className="bpv-muted">Saved model output is a draft, not executed verification. Generation is requested through chat; this panel only reports progress and saved coverage.</p>
      <div className="bpv-actions">
        {active && run.session === sessionId && (
          <button disabled={busy || run.status === "stopping"} onClick={() => void stop()}>
            Stop generation
          </button>
        )}
        {run && <button onClick={onChat}>View generation in chat</button>}
      </div>
      {error && (
        <p role="alert" className="bpv-error">
          {error}
        </p>
      )}
      {run && (
        <div role="status" aria-live="polite">
          {run.status === "scanning" ? (
            <p>
              Reading source…{" "}
              {run.progress
                ? `${run.progress.files} files · ${run.progress.visited} entries checked`
                : "Preparing the scan"}
            </p>
          ) : run.status === "generating" ? (
            <p>
              Generating modules, behavior flows, review findings and
              follow-ups… Saved content appears as the model works.
            </p>
          ) : run.status === "stopping" ? (
            <p>Stopping generation…</p>
          ) : (
            <>
              <p>
                <strong>
                  {run.status === "complete"
                    ? "Generation finished."
                    : run.status === "cancelled"
                      ? "Generation stopped."
                      : "Generation needs attention."}
                </strong>{" "}
                {run.reason}
              </p>
              {run.assessment ? (
                <>
                  <p>
                    <strong>
                      Coverage:{" "}
                      {run.assessmentState === "stale"
                        ? "out of date"
                        : run.assessment.state === "representative"
                          ? "selected operations represented"
                          : run.assessment.state === "partial"
                            ? "partial draft"
                            : "unassessed operations"}
                      .
                    </strong>{" "}
                    Scope: {run.assessment.scope || "Whole project"}.{" "}
                    {run.assessment.scan.files} files inspected
                    {run.assessment.scan.partial
                      ? " in a partial scan"
                      : " in the saved scan"}
                    .
                  </p>
                  {run.assessmentState === "stale" ? (
                    <p>
                      The saved assessment no longer establishes current
                      coverage. Inspect the source map and saved drafts, then
                      request an updated assessment in chat. Earlier counts remain available
                      as history.
                    </p>
                  ) : (
                    <p>
                      {
                        run.assessment.operations.filter(
                          (o) => o.selected && o.scenarios.length,
                        ).length
                      }{" "}
                      of{" "}
                      {
                        run.assessment.operations.filter((o) => o.selected)
                          .length
                      }{" "}
                      selected candidates have source-bound behavior flows.{" "}
                      {run.assessment.operations.filter(
                        (o) => !o.scenarios.length,
                      ).length + run.assessment.deferredOperations}{" "}
                      known candidates remain unexplained. Whole-program
                      coverage is unknown.
                    </p>
                  )}
                  <p className="bpv-muted">
                    Source citations locate an inference; they do not verify
                    runtime behavior. Independent verification is not assessed
                    here.
                  </p>
                  <details>
                    <summary>Scope, operations and remaining gaps</summary>
                    {run.assessment.evidence.statements && (
                      <p>
                        {run.assessment.evidence.statements.anchored} of{" "}
                        {run.assessment.evidence.statements.total} statements
                        have valid source locations;{" "}
                        {run.assessment.evidence.statements.staticBindings}{" "}
                        match static declaration targets;{" "}
                        {run.assessment.evidence.statements.gaps} have support
                        gaps. All {run.assessment.evidence.statements.unchecked}{" "}
                        interpretations remain unchecked. These are separate
                        from executed verification.
                      </p>
                    )}
                    <p>{run.assessment.selection}</p>
                    <p>
                      {run.assessment.evidence.uncheckedClaims} source-bound
                      unchecked claims. {run.assessment.scan.exclusions} scan
                      exclusions; inspect the source map for their reasons.
                    </p>
                    <ul>
                      {run.assessment.areas.map((a) => (
                        <li key={a.path}>
                          {a.path === "." ? "Project root" : a.path}:{" "}
                          {a.explainedFiles} of {a.files} files cited in
                          explanations; {a.componentFiles} bound to components.
                        </li>
                      ))}
                    </ul>
                    {!!run.assessment.deferredAreas && (
                      <p>
                        {run.assessment.deferredAreas} further areas are outside
                        this bounded summary.
                      </p>
                    )}
                    <ul>
                      {run.assessment.gaps.map((g, i) => (
                        <li key={i}>
                          {g.message}{" "}
                          <button
                            onClick={() =>
                              g.view === "Code" || g.view === "Review"
                                ? onCode()
                                : g.view === "Planning"
                                  ? onPlanning()
                                  : onSection(g.view)
                            }
                          >
                            Open {g.view}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <ul>
                      {run.assessment.operations.map((o) => (
                        <li key={o.id}>
                          <strong>{o.name}</strong> · {o.path}:{o.startLine} ·{" "}
                          {o.scenarios.length
                            ? "source-bound flow saved"
                            : "flow missing"}{" "}
                          · {o.selected ? "selected" : "deferred"}
                          <p className="bpv-muted">{o.reason}</p>
                        </li>
                      ))}
                    </ul>
                    {!!run.assessment.deferredOperations && (
                      <p>
                        {run.assessment.deferredOperations} further declaration
                        candidates could not fit in this list. Choose a smaller
                        folder to inspect them.
                      </p>
                    )}
                  </details>
                </>
              ) : (
                <p>
                  <strong>Coverage unassessed.</strong> This run has no saved
                  scope and operation assessment. Saved drafts remain available;
                  no current coverage is established.
                </p>
              )}
              {run.result && !run.assessment && (
                <p>
                  Earlier saved totals: {run.result.files} files inspected
                  {run.result.partial ? " · partial scan" : ""} ·{" "}
                  {run.result.components} components · {run.result.explanations}{" "}
                  explanations · {run.result.connections} inferred connections.
                  {run.result.scenarios !== undefined ? (
                    <>
                      {" "}
                      {run.result.scenarios} behavior flows ·{" "}
                      {run.result.reviewItems} review findings ·{" "}
                      {run.result.followUps} follow-ups.
                    </>
                  ) : (
                    <>
                      {" "}
                      This earlier result covered Structure and Code. Generate
                      again to add Behavior, Review and suggested follow-up tasks.
                    </>
                  )}
                </p>
              )}
              <div className="bpv-actions">
                <button onClick={onPlanning}>View draft modules</button>
                <button onClick={onCode}>View source map</button>
                <button onClick={() => onSection("Behavior")}>
                  View behavior
                </button>
                <button onClick={onCode}>View review findings</button>
                <button onClick={() => onSection("Work")}>
                  View follow-ups
                </button>
              </div>
            </>
          )}
          {active && run.session !== sessionId && (
            <p>This generation is running in another project chat.</p>
          )}
        </div>
      )}
    </section>
  );
}

import React, { useEffect, useState } from "react";

const LABEL: Record<string, string> = {
  built: "Built",
  partial: "Partly built",
  planned: "Not built yet",
  "no-files": "No planned files",
};

// The plan next to the code that actually exists: which planned parts have
// files, what is missing, and dependencies the plan does not allow.
export function PlanCoverageView({
  call,
  sessionId,
  active,
  refreshKey,
  onRecord,
}: {
  call: (op: string, payload?: unknown) => Promise<any>;
  sessionId: string;
  active: boolean;
  refreshKey: unknown;
  onRecord?: (id: string) => void;
}) {
  const [coverage, setCoverage] = useState<any>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = (refresh = false) => {
    setBusy(true);
    setError("");
    return call("session-coverage", {
      session: sessionId,
      command: refresh ? { refresh: true } : {},
    })
      .then(setCoverage)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (active) void load();
  }, [active, sessionId, JSON.stringify(refreshKey)]);
  if (coverage === undefined && !error) return null;
  const components = (coverage?.components ?? []).filter(
    (c: any) => c.state !== "no-files",
  );
  return (
    <section className="bpv-group" aria-label="Plan compared with code">
      <h2>Plan vs code</h2>
      {error && <p className="bpv-error">{error}</p>}
      {coverage === null && <p>No code scan yet.</p>}
      {coverage && (
        <>
          <p className="bpv-muted" role="status">
            {coverage.totals.components
              ? `${coverage.totals.built} of ${coverage.totals.components} planned parts built, ${coverage.totals.partial} partly built, ${coverage.totals.planned} not started.`
              : "No planned part lists its files yet."}{" "}
            {coverage.unplannedCount
              ? `${coverage.unplannedCount} file(s) are outside the plan.`
              : ""}{" "}
            Scanned {new Date(coverage.checkedAt).toLocaleString()}
            .
          </p>
          <button disabled={busy} onClick={() => void load(true)}>
            {busy ? "Scanning…" : "Rescan files"}
          </button>
          {components.length > 0 && (
            <ul className="bpv-coverage-list">
              {components.map((c: any) => (
                <li key={c.id}>
                  <details>
                    <summary>
                      <strong>{c.title}</strong> · {LABEL[c.state] ?? c.state} (
                      {c.present.length}/{c.planned.length} files)
                      {c.unplannedUses.length
                        ? " · uses parts the plan does not allow"
                        : ""}
                    </summary>
                    {onRecord && (
                      <button onClick={() => onRecord(c.id)}>
                        Show in plan
                      </button>
                    )}
                    {c.missing.length > 0 && (
                      <p>Missing: {c.missing.join(", ")}</p>
                    )}
                    {c.uses.length > 0 && <p>Uses: {c.uses.join(", ")}</p>}
                    {c.unplannedUses.length > 0 && (
                      <ul>
                        {c.unplannedUses.map((u: any, i: number) => (
                          <li key={i}>
                            {u.from}:{u.line} imports {u.to} ({u.component}),
                            which its contract does not list.
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
          {coverage.unplannedCount > 0 && (
            <details>
              <summary>
                Files outside the plan ({coverage.unplannedCount})
              </summary>
              <p>
                {coverage.unplanned.join(", ")}
                {coverage.unplannedCount > coverage.unplanned.length ? "…" : ""}
              </p>
            </details>
          )}
          <p className="bpv-muted">{coverage.limits}</p>
        </>
      )}
    </section>
  );
}

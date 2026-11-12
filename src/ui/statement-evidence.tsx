import React from "react";
import type { SourceRequest } from "./source-view.tsx";

export function StatementEvidence({
  support,
  onOpenSource,
  targets,
}: {
  support: any;
  targets?: string[];
  onOpenSource: (request: SourceRequest, origin: HTMLElement) => void;
}) {
  if (!support?.statements) return null;
  const statements = targets
    ? support.statements.filter((s: any) => targets.includes(s.target))
    : support.statements;
  return (
    <section aria-label="Checks against existing code">
      <h3>Confirmed?</h3>
      <p>
        {support.historical
          ? "Code may have changed. Check these files again."
          : "Found in the saved code. Not tested yet."}
      </p>
      {support.withoutSupport && <p>No code references saved for this item.</p>}
      {statements.map((s: any) => (
        <details key={s.target} className="bpv-entry">
          <summary>
            {s.label}: {s.statement} ·{" "}
            {s.gap ? "No matching code found" : "Not tested yet"}
          </summary>
          <p>{s.interpretationGap}</p>
          {s.reason && <p>{s.reason}</p>}
          {s.analyzer && <p className="bpv-muted">{s.analyzer}</p>}
          {s.citations.map((c: any, i: number) => (
            <div key={i}>
              <button
                disabled={!support.digest}
                onClick={(event) =>
                  onOpenSource(
                    {
                      kind: "project",
                      path: c.path,
                      digest: support.digest,
                      title: s.label,
                      startLine: c.startLine,
                      endLine: c.endLine,
                    },
                    event.currentTarget,
                  )
                }
              >
                {c.path}:{c.startLine}–{c.endLine}
              </button>
              <blockquote>{c.quote}</blockquote>
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

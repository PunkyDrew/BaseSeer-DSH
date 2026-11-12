// Change history and design proposals.
import React from "react";
import { friendlyTime } from "./friendly-time.ts";
import { labels } from "./workspace-records.tsx";
import type { WorkspaceState } from "./workspace-contract.ts";

export function ChangeHistory({
  plan,
  open,
  busy,
  error = "",
  undo,
  decide,
}: {
  plan: NonNullable<WorkspaceState["plan"]>;
  /** Shows a record of the plan, when the change still names one. */
  open: (id: string) => void;
  busy: boolean;
  error?: string;
  undo?: () => unknown;
  decide: (
    op: "accept-proposal" | "reject-proposal",
    id: string,
    title: string,
  ) => unknown;
}) {
  const history = [...plan.history].sort((a, b) => b.revision - a.revision);
  const known = new Set(plan.document.records.map((r) => r.id));
  return (
    <section className="bpv-group">
      <h2>How the plan changed</h2>
      {!history.length && <p>No changes have been saved yet.</p>}
      <ol className="bpv-history">
        {history.map((h, index) => (
          <li key={h.revision}>
            <p>
              <strong>
                {h.changes?.length
                  ? `${h.changes.length} ${h.changes.length === 1 ? "change" : "changes"}: `
                  : "Plan updated"}
              </strong>
              {h.changes?.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && ", "}
                  {known.has(c.id) ? (
                    <button className="bpv-link" onClick={() => open(c.id)}>
                      {c.title}
                    </button>
                  ) : (
                    c.title
                  )}
                </React.Fragment>
              ))}
            </p>
            <p className="bpv-muted">{h.reason.replace(/^draft:\s*/, "")}</p>
            <p className="bpv-muted">{friendlyTime(h.time)}</p>
            {index === 0 &&
              undo &&
              h.reason.startsWith("draft:") &&
              h.revision === plan.revision && (
                <button disabled={busy || !!error} onClick={undo}>
                  Undo latest change
                </button>
              )}
          </li>
        ))}
      </ol>
      <h2>Accepted designs</h2>
      {plan.baselines.length ? (
        plan.baselines.map((b) => (
          <p key={b.id}>
            {b.title} · revision {b.revision}
          </p>
        ))
      ) : (
        <p>No design has been accepted yet.</p>
      )}
      {plan.proposals.length > 0 && (
        <>
          <h2>Design proposals</h2>
          {plan.proposals.map((p) => (
            <article key={p.id}>
              <h3>{p.title}</h3>
              <p>
                {p.rationale} · {p.status}
              </p>
              <ul>
                {p.changes.map((c) => (
                  <li key={c.id}>
                    {c.title}{" "}
                    <span className="bpv-muted">{labels[c.kind] ?? c.kind}</span>
                  </li>
                ))}
              </ul>
              {p.status === "draft" && (
                <div>
                  <p className="bpv-muted">
                    Review these changes against the accepted design. Accepting
                    changes the design; it does not change any code.
                  </p>
                  {["accept-proposal", "reject-proposal"].map((op) => (
                    <button
                      key={op}
                      disabled={busy}
                      onClick={() =>
                        void decide(
                          op as "accept-proposal" | "reject-proposal",
                          p.id,
                          p.title,
                        )
                      }
                    >
                      {op === "accept-proposal"
                        ? "Accept reviewed design"
                        : "Abandon proposal"}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

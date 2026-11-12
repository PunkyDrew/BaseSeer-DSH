import React from "react";
import type { Document } from "../domain/records.ts";
import { changeImpact, type ImpactItem } from "./change-impact.ts";

export function ChangeImpact({
  document: doc,
  selected,
  open,
}: {
  document: Document;
  selected: string;
  /** A link that selects the record. */
  open: (id: string) => React.ReactNode;
}) {
  const review = changeImpact(doc, selected);
  if (!review) return null;
  const title = (id: string) =>
    doc.records.find((r) => r.id === id)?.title ?? id;
  const connection = ({ record, path }: ImpactItem) => (
    <li key={record.id}>
      <p>
        {open(record.id)} {path[0].kind.replaceAll("-", " ")}{" "}
        <strong>{title(path[0].to)}</strong>.
      </p>
      <p>{path[0].scope || "No relationship rationale is recorded."}</p>
      <p className="bpv-muted">
        {path.length > 1
          ? "Through another part."
          : path[0].kind === "implements"
            ? "Provides this contract."
            : "Relies on it directly."}
      </p>
      <details>
        <summary>Recorded reason and dependency path</summary>
        <p>{record.data.responsibility}</p>
        <ol>
          {path.map((link) => (
            <li key={link.id}>
              <p>
                {title(link.from)} {link.kind.replaceAll("-", " ")}{" "}
                {title(link.to)}: {link.scope || "No rationale recorded."}
              </p>
            </li>
          ))}
        </ol>
        <p className="bpv-muted">One path in the plan; not checked against code.</p>
      </details>
    </li>
  );
  return (
    <section className="bpg-impact" aria-label="Change impact review">
      <h3>What a change here touches</h3>
      <p className="bpv-muted">The parts that depend on this one, and why.</p>
      {review.direct.length ? (
        <ul className="bpg-impact-items">{review.direct.map(connection)}</ul>
      ) : (
        <p>No dependents are recorded, which doesn't make a change safe.</p>
      )}
      {!!review.indirect.length && (
        <details>
          <summary>
            Further connected components ({review.indirect.length})
          </summary>
          <ul className="bpg-impact-items">
            {review.indirect.map(connection)}
          </ul>
        </details>
      )}
      <details>
        <summary>Linked requirements and evidence</summary>
        <h4>Requirements to review</h4>
        {review.requirements.length ? (
          <ul>
            {review.requirements.map((r) => (
              <li key={r.id}>{open(r.id)}</li>
            ))}
          </ul>
        ) : (
          <p>No requirements are linked to these components.</p>
        )}
        <h4>Recorded evidence to inspect</h4>
        <p className="bpv-muted">An old pass does not verify a new change.</p>
        {review.evidence.length ? (
          <ul>
            {review.evidence.map((r) => (
              <li key={r.id}>{open(r.id)}</li>
            ))}
          </ul>
        ) : (
          <p>No executed evidence is linked to these items.</p>
        )}
      </details>
    </section>
  );
}

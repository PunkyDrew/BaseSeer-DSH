// Planning-record labels, status and detail bodies, split from workspace-panel.tsx. Moved verbatim.
import React from "react";
import { codeCheckCopy } from "./code-check-copy.ts";
import type { PlanningRecord } from "../domain/records.ts";
import { StatementEvidence } from "./statement-evidence.tsx";
import type { SourceRequest } from "./source-view.tsx";
import type { WorkspaceState } from "./workspace-contract.ts";
import {
  cardFiles,
  cardTechnology,
  componentType,
  plainPlace,
  componentParent,
} from "./graph-card.ts";

export const labels: Record<string, string> = {
  requirement: "Requirement",
  component: "Component",
  interface: "Interface",
  scenario: "Scenario",
  decision: "Decision",
  question: "Open question",
  task: "Task",
  mapping: "Source link",
  claim: "Claim",
  evidence: "Evidence",
  analysis: "Analysis",
  finding: "Finding",
};

/** A record's facts as a ruled key list. */
const facts = (rows: [string, React.ReactNode][]) => (
  <dl className="bpv-facts">
    {rows.map(([key, value]) => (
      <div key={key}>
        <dt>{key}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
);
export const bullets = (items: string[]) =>
  items?.length ? (
    <ul>
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  ) : null;

export function recordStatus(plan: WorkspaceState["plan"], r: PlanningRecord) {
  if (r.kind === "task")
    return r.data.state === "cancelled"
      ? "Cancelled"
      : r.data.state === "ready-for-review"
        ? "Ready for review"
        : "";
  if (r.kind === "evidence") return `${r.data.method} · ${r.data.assessment}`;
  if (r.kind === "analysis")
    return r.data.outcome === "completed" ? "" : "Partly checked";
  if (r.kind === "claim") return `${r.data.origin} · ${r.data.assessment}`;
  if (r.kind === "mapping") return "Source anchor · inspect freshness";
  const accepted = plan?.baselines
    .find((b: any) => b.id === plan.baseline)
    ?.document.records.find((b: any) => b.id === r.id);
  return accepted?.version === r.version
    ? "Accepted design"
    : r.status === "superseded"
      ? "Superseded"
      : r.status === "accepted"
        ? "Accepted"
        : "";
}

export type RecordBodyContext = {
  state: WorkspaceState;
  ref: (id: string) => React.ReactNode;
  openSource: (request: SourceRequest, element: HTMLElement) => void;
};
export function recordDetails(
  r: PlanningRecord,
  ref: (id: string) => React.ReactNode,
) {
  if (r.kind !== "component") return null;
  const d = r.data;
  return (
    <details>
      <summary>Details</summary>
      <h4>Role</h4>
      <p>
        {componentType(r)}
        {d.c4?.external ? " · External" : ""}
      </p>
      {d.observed && (
        <>
          <h4>Existing files</h4>
          {bullets(d.observed.paths)}
          <h4>Observed inputs</h4>
          {bullets(d.observed.inputs)}
          <h4>Observed outputs</h4>
          {bullets(d.observed.outputs)}
          <h4>Observed state</h4>
          {bullets(d.observed.state)}
          {!d.contract && (
            <p>
              Inputs, outputs and allowed dependencies have not been planned
              yet.
            </p>
          )}
        </>
      )}
      {d.contract && (
        <>
          {(
            [
              ["Inputs", d.contract.inputs],
              ["Outputs", d.contract.outputs],
              ["Owns", d.contract.owns],
              ["Shared records it writes", d.contract.writes],
            ] as [string, string[] | undefined][]
          )
            .filter(([, names]) => names?.length)
            .map(([heading, names]) => (
              <React.Fragment key={heading}>
                <h4>{heading}</h4>
                {bullets(names!)}
              </React.Fragment>
            ))}
          <h4>Can use</h4>
          {d.contract.allowedDependencies.length ? (
            d.contract.allowedDependencies.map((id: string) => (
              <p key={id}>{ref(id)}</p>
            ))
          ) : (
            <p>No other parts allowed.</p>
          )}
        </>
      )}
      {d.screen && (
        <>
          <h4>Planned screen</h4>
          <p>{d.screen.purpose}</p>
          {d.screen.primaryAction && (
            <p>
              <strong>Main action:</strong> {d.screen.primaryAction}
            </p>
          )}
          {d.screen.checks?.length > 0 && (
            <>
              <h4>Screen checks</h4>
              {bullets(d.screen.checks)}
            </>
          )}
        </>
      )}
    </details>
  );
}

export function recordBody(
  r: PlanningRecord,
  { state, ref, openSource }: RecordBodyContext,
) {
  const d = r.data;
  switch (r.kind) {
    case "requirement":
      return (
        <>
          <p>{d.rationale}</p>
          <p className="bpv-muted">Scope: {d.scope}</p>
        </>
      );
    case "component": {
      const type = componentType(r);
      const technology = cardTechnology(r);
      const files = cardFiles(r);
      const document = state.plan?.document;
      const children = (document?.records ?? []).filter(
        (child) =>
          child.kind === "component" &&
          child.id !== r.id &&
          (child.data.parent === r.id ||
            document?.links.some(
              (link) =>
                link.kind === "parent" &&
                link.from === child.id &&
                link.to === r.id,
            )),
      );
      const contains = ["Container", "System"].includes(type);
      const parent = componentParent(
        r,
        document?.records ?? [],
        document?.links ?? [],
      );
      const buildable =
        !d.c4?.external && ["Component", "Container"].includes(type);
      return (
        <>
          {facts([
            [
              type === "Person" ? "Kind" : "Built with",
              type === "Person" ? "A person" : technology || "Not chosen yet",
            ],
            parent && !d.c4?.external && ["Container", "Component"].includes(type)
              ? [type === "Container" ? "Runs in" : "Part of", ref(parent.id)]
              : ["Place", plainPlace(r, document?.records ?? [], document?.links ?? [])],
            ["Does", d.responsibility || "Purpose not recorded yet"],
            ...(buildable
              ? [["Model", d.build ? `${d.build.model} (${d.build.thinking})` : "Not chosen yet"] as [string, React.ReactNode]]
              : []),
            ...(contains
              ? [
                  [
                    "Contains",
                    children.length
                      ? children.map((child, index) => (
                          <React.Fragment key={child.id}>
                            {index > 0 && ", "}
                            {ref(child.id)}
                          </React.Fragment>
                        ))
                      : "No parts recorded yet",
                  ] as [string, React.ReactNode],
                ]
              : []),
          ])}
          {buildable && (
            <>
              <h4>Files</h4>
              {files.length ? (
                <ul className="bpv-files">
                  {files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : (
                <p>Not chosen yet</p>
              )}
            </>
          )}
          <StatementEvidence
            support={state.recordSupport?.[r.id]}
            onOpenSource={openSource}
          />
        </>
      );
    }
    case "interface":
      return (
        <>
          {facts([
            ["Format", d.format?.trim() || "Not chosen yet"],
            ["Place", plainPlace(r)],
            ["Does", d.responsibility || "Purpose not recorded yet"],
          ])}
          {d.shapes?.length > 0 && (
            <details>
              <summary>Shared record shapes ({d.shapes.length})</summary>
              {d.shapes.map((s: any) => (
                <div key={s.name}>
                  <h4>
                    {s.name}
                    {s.version ? ` (version ${s.version})` : ""}
                  </h4>
                  {bullets(s.fields)}
                </div>
              ))}
            </details>
          )}
        </>
      );
    case "decision":
      return (
        <>
          <p>{d.context}</p>
          <p>
            <strong>{d.choice}</strong>
          </p>
          <h4>Alternatives</h4>
          {bullets(d.alternatives)}
        </>
      );
    case "question":
      return <p>{d.question}</p>;
    case "task":
      return (
        <>
          <p>{d.scope}</p>
          <p className="bpv-muted">Planned follow-up work, not part of a build</p>
          <h4>Checks</h4>
          {bullets(d.checks)}
          {d.dependencies.length > 0 && (
            <p>
              Depends on:{" "}
              {d.dependencies.map((id: string) => (
                <React.Fragment key={id}>{ref(id)} </React.Fragment>
              ))}
            </p>
          )}
        </>
      );
    case "scenario":
      return (
        <>
          <p>
            <strong>When:</strong> {d.trigger}
          </p>
          {bullets(d.preconditions)}
          <ol className="bpv-flow">
            {d.steps.map((s: any, i: number) => (
              <li key={i}>
                {s.component && ref(s.component)}
                <p>{s.action}</p>
                <p className="bpv-muted">{s.outcome}</p>
              </li>
            ))}
          </ol>
          <h4>If something goes wrong</h4>
          {bullets(d.errors)}
          <p>{d.recovery}</p>
          <p className="bpv-muted">
            {d.source
              ? "Inferred from source; this sequence has not been verified by execution."
              : "Planned behavior; this sequence is not an execution trace."}
          </p>
          {d.source && (
            <>
              <h4>Source for this flow</h4>
              <StatementEvidence
                support={state.recordSupport?.[r.id]}
                onOpenSource={openSource}
              />
              <p className="bpv-muted">
                {state.scenarioSources?.[r.id]?.historical !== false
                  ? "Historical or unavailable citations. Generate again to reassess this flow against current source."
                  : "Matches the saved scan. Source freshness is checked when opened."}
              </p>
              {(state.scenarioSources?.[r.id]?.sources ?? []).map(
                (s: any, i: number) => (
                  <div key={i}>
                    <button
                      disabled={!state.scenarioSources![r.id].digest}
                      onClick={(event) =>
                        openSource(
                          {
                            kind: "project",
                            path: s.path,
                            digest: state.scenarioSources![r.id].digest,
                            title: `${r.title} — ${s.path}`,
                            startLine: s.startLine,
                            endLine: s.endLine,
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      {s.path}:{s.startLine}–{s.endLine}
                    </button>
                    <blockquote>{s.quote}</blockquote>
                  </div>
                ),
              )}
            </>
          )}
        </>
      );
    case "mapping":
      return (
        <>
          <p>
            <code>
              {d.path}:{d.startLine}–{d.endLine}
            </code>
            {d.symbol && ` · ${d.symbol}`}
          </p>
          <p>{d.language || "Language not recorded"} · manual source link</p>
          <p className="bpv-muted">
            Snapshot: {ref(d.snapshot)}. A source link alone does not verify
            behavior.
          </p>
        </>
      );
    case "claim":
      return (
        <>
          <p>{d.statement}</p>
          <p>
            Origin: {d.origin} · Assessment: {d.assessment}
          </p>
          <p>About: {ref(d.subject)}</p>
          <p>{d.scope}</p>
        </>
      );
    case "evidence":
      return (
        <>
          <p>{d.result}</p>
          <p>
            Method: {d.method} · Assessment: {d.assessment}
          </p>
          <p>
            {d.tool} {d.toolVersion} · {d.time}
          </p>
          <p>{d.scope}</p>
        </>
      );
    case "finding":
      return (
        <>
          <p>{d.description}</p>
          <p>{d.resolution}</p>
        </>
      );
    case "analysis":
      return (
        <>
          <p>{codeCheckCopy(r, state.plan!.document).result}</p>
          <p>
            {d.tool} {d.version}
          </p>
          {bullets(d.gaps)}
        </>
      );
    case "snapshot":
      return (
        <>
          <p>
            Branch: {d.branch} ·{" "}
            {d.dirty ? "Uncommitted changes" : "Clean snapshot"}
          </p>
          <p>
            <code>{d.commit}</code>
          </p>
          <p>
            {d.sourceAvailability === "included"
              ? "Source files included"
              : d.sourceAvailability === "separate"
                ? "Source files stored separately"
                : "Source files unavailable"}
          </p>
        </>
      );
    default:
      return <p>{d.label ?? "Supporting project record"}</p>;
  }
}

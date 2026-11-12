// The selected plan item: a diagram element with its record, or a record alone.
import React, { useEffect, useRef } from "react";
import type { PlanningRecord, Link } from "../domain/records.ts";
import type { GraphItem } from "./graph-model.ts";
import { StatementEvidence } from "./statement-evidence.tsx";
import { ChangeImpact } from "./change-impact.tsx";
import type { SourceRequest } from "./source-view.tsx";
import type { WorkspaceState } from "./workspace-contract.ts";
import { labels, recordDetails } from "./workspace-records.tsx";

export function connectionVerb(type: string, outgoing: boolean): string {
  const verbs: Record<string, [string, string]> = {
    satisfies: ["Meets", "Met by"],
    "depends-on": ["Depends on", "This is needed by"],
    implements: ["Provides", "Provided by"],
    uses: ["Uses", "Used by"],
    "maps-to": ["Found in", "Shows"],
    supports: ["Supports", "Supported by"],
    contradicts: ["Conflicts with", "Conflicts with"],
    addresses: ["Shapes", "Shaped by"],
    parent: ["Part of", "Contains"],
  };
  return verbs[type]?.[outgoing ? 0 : 1] ?? "Connected to";
}

export function connectionGroups(
  current: PlanningRecord,
  records: PlanningRecord[],
  links: Link[],
): { heading: string; links: Link[] }[] {
  const headings = [
    "Uses",
    "Used by",
    "Provides",
    "Needed for",
    "Part of these steps",
    "Decisions that shape it",
    "Other connections",
  ];
  const groups = new Map(headings.map((heading) => [heading, [] as Link[]]));
  for (const link of links) {
    if (link.from !== current.id && link.to !== current.id) continue;
    const outgoing = link.from === current.id;
    const other = records.find(
      (record) => record.id === (outgoing ? link.to : link.from),
    );
    const heading =
      other?.kind === "decision"
        ? "Decisions that shape it"
        : ["scenario", "behavior"].includes(other?.kind ?? "")
          ? "Part of these steps"
          : other?.kind === "interface" &&
              link.kind === "implements" &&
              outgoing
            ? "Provides"
            : other?.kind === "requirement" &&
                link.kind === "satisfies" &&
                outgoing
              ? "Needed for"
              : other?.kind === "component"
                ? outgoing
                  ? "Uses"
                  : "Used by"
                : "Other connections";
    groups.get(heading)!.push(link);
  }
  return headings.flatMap((heading) => {
    const links = groups.get(heading)!;
    return links.length ? [{ heading, links }] : [];
  });
}

export function SelectedPlanItem({
  current,
  graphItem,
  state,
  plan,
  records,
  links,
  recordLink,
  status,
  body,
  openSource,
  discuss,
  onClose,
}: {
  current: PlanningRecord | undefined;
  graphItem: GraphItem | null;
  state: WorkspaceState;
  plan: NonNullable<WorkspaceState["plan"]>;
  records: PlanningRecord[];
  links: Link[];
  recordLink: (id: string) => React.ReactNode;
  status: (r: PlanningRecord) => string;
  body: (r: PlanningRecord) => React.ReactNode;
  openSource: (request: SourceRequest, element: HTMLElement) => void;
  discuss: (id: string, title: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.closest(".bpv-side")?.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() => {
      panel.current
        ?.querySelector<HTMLElement>("h2")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current?.id, graphItem?.id]);
  return (
    <section ref={panel} className="bpv-detail">
      <div className="bpv-detail-bar">
        <button className="bpv-back" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 8H3M7 4L3 8l4 4" />
          </svg>
          All items
        </button>
        {current && (
          <button onClick={() => void discuss(current.id, current.title)}>
            Discuss in chat
          </button>
        )}
      </div>
      {graphItem &&
        (!current || graphItem.id !== current.id || graphItem.details) && (
          <>
            <h2 tabIndex={-1}>{graphItem.title}</h2>
            <p className="bpv-muted">{graphItem.kind}</p>
            <p>{graphItem.summary}</p>
            {graphItem.supportTargets && (
              <StatementEvidence
                support={
                  state.recordSupport?.[
                    graphItem.basis ?? graphItem.record ?? ""
                  ]
                }
                targets={graphItem.supportTargets}
                onOpenSource={openSource}
              />
            )}
            {graphItem.details?.map((d) => (
              <section key={d.label}>
                <h3>{d.label}</h3>
                <p>{d.text}</p>
              </section>
            ))}
            {graphItem.link && (
              <>
                <p>
                  {recordLink(graphItem.link.from)}{" "}
                  {connectionVerb(graphItem.link.kind, true).toLowerCase()}{" "}
                  {recordLink(graphItem.link.to)}
                </p>
                <h3>Confirmed?</h3>
                {graphItem.link.evidence.length ? (
                  graphItem.link.evidence.map((id) => (
                    <p key={id}>{recordLink(id)}</p>
                  ))
                ) : (
                  <p>
                    Not yet — this is what the plan intends; nothing has checked
                    it.
                  </p>
                )}
              </>
            )}
          </>
        )}
      {current && (
        <>
          <h2 tabIndex={-1}>{current.title}</h2>
          <p className="bpv-muted">
            {["component", "interface"].includes(current.kind)
              ? status(current)
              : [labels[current.kind] ?? current.kind, status(current)]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
          {current.data.source && (
            <p className="bpv-muted">
              Found in your existing code, not decided in chat.
            </p>
          )}
          {body(current)}
          <h3>Connected to</h3>
          {(() => {
            const groups = connectionGroups(current, records, links);
            const renderGroup = (group: (typeof groups)[number]) => (
              <section key={group.heading} aria-label={group.heading}>
                <h4>{group.heading}</h4>
                {group.links.map((l) => (
                  <p key={l.id}>
                    {group.heading === "Other connections" && (
                      <>{connectionVerb(l.kind, l.from === current.id)} </>
                    )}
                    {recordLink(l.from === current.id ? l.to : l.from)}
                  </p>
                ))}
              </section>
            );
            return groups.length ? (
              <>
                {groups.slice(0, 2).map(renderGroup)}
                {groups.length > 2 && (
                  <details>
                    <summary>
                      More connections (
                      {groups
                        .slice(2)
                        .reduce(
                          (total, group) => total + group.links.length,
                          0,
                        )}
                      )
                    </summary>
                    {groups.slice(2).map(renderGroup)}
                  </details>
                )}
              </>
            ) : (
              <p className="bpv-muted">No recorded connections yet.</p>
            );
          })()}
          {["component", "interface"].includes(current.kind) && (
            <ChangeImpact
              document={plan.document}
              selected={current.id}
              open={recordLink}
            />
          )}
          {recordDetails(current, recordLink)}
          {(() => {
            const ids = new Set([current.id]);
            for (let pass = 0; pass < 3; pass++)
              for (const l of links)
                if (
                  ["satisfies", "maps-to", "supports", "addresses"].includes(
                    l.kind,
                  ) &&
                  (ids.has(l.from) || ids.has(l.to))
                ) {
                  ids.add(l.from);
                  ids.add(l.to);
                }
            const mapped = records.filter(
              (r) => r.kind === "mapping" && ids.has(r.id),
            );
            return mapped.length ? (
              <>
                <h3>Supporting source</h3>
                {mapped.map((r) => (
                  <p key={r.id}>
                    {recordLink(r.id)} ·{" "}
                    <code>
                      {r.data.path}:{r.data.startLine}
                    </code>
                  </p>
                ))}
              </>
            ) : null;
          })()}
        </>
      )}
    </section>
  );
}

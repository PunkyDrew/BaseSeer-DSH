import React, { useState } from "react";
import type { PlanningRecord } from "../domain/records.ts";
import { codeCheckCopy } from "./code-check-copy.ts";
import { nodeColor } from "./graph-presentation.ts";

// The plan's items in the order the owner thinks in: what it must do, the
// choices made, what is open, then the design and its evidence.
const groups: { title: string; kinds: PlanningRecord["kind"][] }[] = [
  { title: "Requirements", kinds: ["requirement"] },
  { title: "Decisions", kinds: ["decision"] },
  { title: "Open questions", kinds: ["question"] },
  { title: "Components", kinds: ["component"] },
  { title: "Interfaces", kinds: ["interface"] },
  { title: "Scenarios", kinds: ["scenario"] },
  { title: "Follow-up work", kinds: ["task"] },
  {
    title: "Checks and source links",
    kinds: ["mapping", "claim", "evidence", "finding", "analysis", "snapshot"],
  },
];
const summary = (r: PlanningRecord) =>
  r.data.responsibility ??
  r.data.choice ??
  r.data.question ??
  r.data.scope ??
  r.data.trigger ??
  r.data.description ??
  r.data.statement ??
  "";

export function PlanItems({
  records,
  status,
  onSelect,
}: {
  records: PlanningRecord[];
  status: (record: PlanningRecord) => string;
  onSelect: (record: PlanningRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const title = (r: PlanningRecord) =>
    ["analysis", "snapshot"].includes(r.kind)
      ? codeCheckCopy(r, { records }).title
      : r.title;
  const matches = (r: PlanningRecord) =>
    !query ||
    `${title(r)} ${summary(r)} ${status(r)}`.toLowerCase().includes(query);
  const shown = groups
    .map((group) => ({
      ...group,
      records: records.filter(
        (r) => group.kinds.includes(r.kind) && matches(r),
      ),
    }))
    .filter((group) => group.records.length);
  return (
    <div className="bpv-items">
      <input
        type="search"
        aria-label="Find a plan item"
        placeholder={`Find among ${records.length} items`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {!shown.length && (
        <p className="bpv-items-empty bpv-muted">
          {records.length
            ? "Nothing matches."
            : "The plan's parts appear here as they are saved in the Planning chat."}
        </p>
      )}
      {shown.map((group) => (
        <details key={group.title} open>
          <summary>
            <i
              className="bpv-kind"
              aria-hidden="true"
              style={{ "--k": nodeColor(group.kinds[0]) } as React.CSSProperties}
            />
            {group.title}
            <span className="bpv-muted">{group.records.length}</span>
          </summary>
          <ul>
            {group.records.map((r) => (
              <li key={r.id}>
                <button onClick={() => onSelect(r)}>
                  {title(r)}
                  {(summary(r) || status(r)) && (
                    <span>
                      {[status(r), summary(r)].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

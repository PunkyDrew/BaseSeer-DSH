import React from "react";
import type { Document } from "../../domain/records.ts";
import { partColor } from "../graph-presentation.ts";
import { scenarioMatrix } from "./scenario.ts";

/** Which parts take steps in which flows, as a table: a row per part, a column per flow, the number of steps in each cell. */
export function ScenarioMatrix({
  document: doc,
  onPart,
  onScenario,
  onCell,
}: {
  document: Document;
  /** Opens the flows through a part. */
  onPart: (part: string) => void;
  /** Opens a flow. */
  onScenario: (scenario: string) => void;
  /** Opens a flow through a part. */
  onCell: (part: string, scenario: string) => void;
}) {
  const { scenarios, parts, count } = scenarioMatrix(doc);
  if (!scenarios.length)
    return (
      <div className="bpg-empty" role="status">
        <p>No flow yet. Describe an operation in the chat to map it.</p>
      </div>
    );
  return (
    <div className="bpg-matrix">
      <table>
        <caption>
          Which parts take steps in which flows. A number is the steps; it opens that flow through that part.
        </caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            {scenarios.map((s) => (
              <th scope="col" key={s.id}>
                <button onClick={() => onScenario(s.id)}>{s.title}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.id}>
              <th scope="row" style={{ "--k": partColor(doc, part.id) } as React.CSSProperties}>
                <button onClick={() => onPart(part.id)}>{part.title}</button>
              </th>
              {scenarios.map((s, i) => {
                const n = count(part.id, i);
                return (
                  <td key={s.id} data-steps={n || undefined}>
                    {n ? (
                      <button
                        aria-label={`${n} ${n === 1 ? "step" : "steps"} of ${part.title} in ${s.title}`}
                        onClick={() => onCell(part.id, s.id)}
                      >
                        {n}
                      </button>
                    ) : (
                      <span>0</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bpv-muted">The saved plan, not running code.</p>
    </div>
  );
}

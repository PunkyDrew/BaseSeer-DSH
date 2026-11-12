import React from "react";
import type { Notation } from "./types.ts";

// The key of each standard view: every symbol it draws, drawn the same way.
const dashed = "4 3";
const open = <path d="M30 6L36 10L30 14" fill="none" />;
const filled = <path d="M30 6L36 10L30 14Z" style={{ fill: "currentColor" }} />;
const line = (head: React.ReactNode, dash?: string) => (
  <>
    <path d="M3 10H35" strokeDasharray={dash} />
    {head}
  </>
);
const symbols = {
  component: (
    <>
      <rect x="4" y="3" width="32" height="14" rx="1" className="bpg-key-component" />
      <rect x="27" y="5" width="6" height="8" fill="none" />
      <rect x="25" y="6" width="4" height="2" fill="none" />
      <rect x="25" y="10" width="4" height="2" fill="none" />
    </>
  ),
  interface: <rect x="4" y="3" width="32" height="14" rx="1" className="bpg-key-interface" />,
  class: (
    <>
      <rect x="4" y="2" width="32" height="16" rx="1" className="bpg-key-interface" />
      <path d="M4 9H36" />
    </>
  ),
  node: (
    <>
      <rect x="4" y="6" width="26" height="12" className="bpg-key-node" />
      <path d="M4 6L10 1H36V13L30 18M30 6L36 1" fill="none" />
    </>
  ),
  composition: (
    <>
      <path d="M14 10H37" />
      <path d="M3 10L8.5 6L14 10L8.5 14Z" style={{ fill: "currentColor" }} />
    </>
  ),
  path: <path d="M3 10H37" />,
  comment: (
    <>
      <path d="M4 3H30L36 9V17H4Z" fill="none" />
      <path d="M30 3V9H36" fill="none" />
    </>
  ),
  anchor: <path d="M3 10H37" strokeDasharray="3 2" />,
  dependency: line(open, dashed),
  realization: line(<path d="M28 5L36 10L28 15Z" style={{ fill: "var(--paper)" }} />, dashed),
  start: <circle cx="20" cy="10" r="6" style={{ fill: "currentColor" }} />,
  trigger: <path d="M4 3H36V17H4L9 10Z" fill="none" />,
  action: <rect x="4" y="3" width="32" height="14" rx="6" fill="none" />,
  diamond: <path d="M20 2L28 10L20 18L12 10Z" fill="none" />,
  end: (
    <>
      <circle cx="20" cy="10" r="7" fill="none" />
      <circle cx="20" cy="10" r="4" style={{ fill: "currentColor" }} />
    </>
  ),
  lifeline: (
    <>
      <rect x="10" y="1" width="20" height="7" fill="none" />
      <path d="M20 8V19" strokeDasharray="3 2" />
    </>
  ),
  found: (
    <>
      <circle cx="5" cy="10" r="3" style={{ fill: "currentColor" }} />
      {line(open)}
    </>
  ),
  message: line(open),
  synchronous: line(filled),
  failure: <g className="bpg-key-failure">{line(open)}</g>,
  recovery: <g className="bpg-key-recovery">{line(open)}</g>,
  reply: line(open, dashed),
  fragment: (
    <>
      <rect x="3" y="2" width="34" height="16" fill="none" />
      <path d="M3 2H15V6L13 8H3" fill="none" />
    </>
  ),
};
type Entry = [keyof typeof symbols, string];
const paths: Entry[] = [
  ["failure", "Failure path, in red, with its guard"],
  ["recovery", "Recovery path"],
];
const keys: Record<string, Entry[]> = {
  "uml-component": [
    ["component", "«component»; drawn inside another, it is part of it"],
    ["interface", "«interface»: what crosses between parts"],
    ["dependency", "Dependency: uses"],
    ["realization", "Realization: provides"],
  ],
  "uml-class": [
    ["class", "«dataType»: a record and its fields, inside the «interface» that carries it; an empty compartment is a record with no agreed shape"],
    ["component", "«component»: a part whose contract names records"],
    ["dependency", "«flow» between two parts: the record named on it passes along a recorded dependency"],
    ["composition", "Composition: the part owns the record"],
    ["dependency", "«use», «create»: the part takes the record in, or gives it out, with no part at the other end"],
  ],
  "uml-deployment": [
    ["node", "Node: where software runs; «executionEnvironment» is a container, with its technology"],
    ["component", "«component» drawn inside a node runs there"],
    ["path", "Communication path, labelled with the format that crosses it"],
  ],
  links: [
    ["component", "The part, and the parts linked to it"],
    ["dependency", "Uses, labelled with the plan's reason"],
    ["realization", "Provides"],
  ],
  flow: [
    ["start", "Initial node"],
    ["trigger", "Accept event action: the trigger"],
    ["action", "Action, in its part's partition, its outcome under it"],
    ["diamond", "Decision or merge node, [guard] on each way out"],
    ["end", "Activity final node"],
    ...paths,
  ],
  "uml-sequence": [
    ["lifeline", "Lifeline; its bar is an execution"],
    ["found", "Found message: the trigger, from outside"],
    ["synchronous", "Synchronous call, named after the step it asks for"],
    ["reply", "Reply, carrying the outcome"],
    ["message", "Asynchronous message: the sender goes on"],
    ["fragment", "alt, break, loop: only under [guard]"],
    ...paths,
  ],
};

export function NotationKey({
  notation,
  links = false,
  parts = [],
  layers,
}: {
  notation: Notation;
  links?: boolean;
  /** A flow's parts, each with the hue its lane or lifeline wears; the hues are the kinds' elsewhere, so the key names them. */
  parts?: { title: string; color: string }[];
  /** The comments the Component picture draws beside its parts. */
  layers?: { traceability: boolean; sources: boolean };
}) {
  const entries: Entry[] = [
    ...(keys[links ? "links" : notation] ?? []),
    ...(layers?.traceability
      ? [["comment", "«requirement», «decision», «question»: a comment on what it is anchored to"] as Entry]
      : []),
    ...(layers?.sources ? [["comment", "«source»: where a part lives in the code"] as Entry] : []),
    ...(layers?.traceability || layers?.sources ? [["anchor", "Anchor: the comment's subject"] as Entry] : []),
  ];
  return (
    <>
      <ul className="bpg-notation-key">
        {entries.map(([symbol, text]) => (
          <li key={text}>
            <svg viewBox="0 0 40 20" width="40" height="20" aria-hidden="true">
              {symbols[symbol]}
            </svg>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {parts.length > 0 && (
        <>
          <p>{notation === "uml-sequence" ? "Each lifeline is a part:" : "Each lane is a part:"}</p>
          <ul className="bpg-notation-key">
            {parts.map((part) => (
              <li key={part.title}>
                <svg viewBox="0 0 40 20" width="40" height="20" aria-hidden="true">
                  <rect x="6" y="3" width="28" height="14" className="bpg-key-lane" style={{ "--k": part.color } as React.CSSProperties} />
                </svg>
                <span>{part.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="bpv-muted">The saved plan, not running code.</p>
    </>
  );
}

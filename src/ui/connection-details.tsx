import React from "react";
import { connectionBasis, type ConnectionGroup } from "./connection-groups.ts";

export function ConnectionDetails({
  groups,
  selected,
  focused,
  onSelect,
  onSource,
  sourceChanged,
}: {
  groups: ConnectionGroup[];
  selected: string;
  focused: string;
  onSelect: (id: string) => void;
  onSource: (line: number, path: string) => void;
  sourceChanged: boolean;
}) {
  const group = groups.find((g) => g.id === selected);
  return (
    <>
      <p>
        Each arrow groups references in one direction between files. Select a
        connection to read its individual references and source evidence.
        Inferred explanations remain separate.
      </p>
      {group && (
        <article aria-label="Selected connection" key={group.id}>
          <h4>{group.label}</h4>
          <p>
            {group.from} → {group.to}
          </p>
          <p>
            {group.basis === "observed"
              ? "Observed source relationships"
              : "Inferred explanation"}
            {group.stale
              ? " · Historical"
              : sourceChanged
                ? " · Source has changed"
                : " · Saved source evidence"}
            . This does not establish execution order.
          </p>
          {group.items.map((item) => (
            <details key={item.id} open={group.items.length === 1}>
              <summary>
                {item.label} · line {item.citations[0]?.startLine ?? "unknown"}
              </summary>
              <p>{connectionBasis(item)}</p>
              <p>{item.detail}</p>
              <ul>
                {item.citations.map((ref, i) => (
                  <li key={i}>
                    <button
                      className="bpv-link"
                      disabled={item.stale || sourceChanged}
                      onClick={() => onSource(ref.startLine, ref.path)}
                    >
                      {ref.path}:{ref.startLine} · Connection source
                    </button>
                    {item.stale && ref.quote && (
                      <blockquote>{ref.quote}</blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </article>
      )}
      {[
        {
          title: "Incoming connections",
          items: groups.filter((g) => g.to === focused),
        },
        {
          title: "Outgoing connections",
          items: groups.filter((g) => g.from === focused),
        },
      ].map((direction) => (
        <details key={direction.title} open>
          <summary>
            {direction.title} ({direction.items.length})
          </summary>
          <ul>
            {direction.items.map((g) => (
              <li key={g.id}>
                <button className="bpv-link" onClick={() => onSelect(g.id)}>
                  {(g.from === focused ? g.to : g.from).split("/").at(-1)} ·{" "}
                  {g.label}
                </button>
                <span className="bpv-muted"> · {g.basis}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

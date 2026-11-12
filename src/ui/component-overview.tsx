import React, { useEffect, useRef, useState } from "react";
import type {
  ComponentMap,
  MappedComponent,
} from "../contracts/component-map.ts";
import type { SourceConnection } from "../contracts/source-connections.ts";

const basis = (c: MappedComponent) =>
  c.basis === "source-inferred"
    ? "Source-inferred · interpretation unchecked"
    : c.basis === "historical"
      ? "Historical source binding"
      : "No observed source mapping";

function PagedList<T>({
  items,
  render,
  label,
}: {
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
  label: string;
}) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(items.length / 40) - 1),
    current = Math.min(page, last);
  return (
    <>
      <ul className="bpcm-evidence">
        {items
          .slice(current * 40, (current + 1) * 40)
          .map((item, i) => render(item, current * 40 + i))}
      </ul>
      {!!last && (
        <div className="bpc-controls" aria-label={label}>
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            Page {current + 1} of {last + 1} · {items.length} items
          </span>
          <button
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

export function ComponentOverview({
  map,
  sourceCurrent,
  onFile,
  onSource,
  onRecord,
}: {
  map: ComponentMap;
  sourceCurrent: boolean;
  onFile: (path: string) => void;
  onSource: (line: number, path: string) => void;
  onRecord?: (id: string) => void;
}) {
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const mapped = map.components.filter((c) => c.paths.length);
  const component =
    map.components.find((c) => c.id === selected) ??
    mapped[0] ??
    map.components[0];
  const title = (id: string) =>
    map.components.find((c) => c.id === id)?.title ?? id;
  const related = map.relationships.filter(
    (r) => r.from === component?.id || r.to === component?.id,
  );
  const matching = map.components.filter((c) =>
    `${c.title} ${c.responsibility} ${c.proposedPaths.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [search, map.digest]);
  const choose = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: false }),
    );
  };
  const refs = (items: SourceConnection[]) => (
    <PagedList
      items={items}
      label="Evidence pages"
      render={(item) => (
        <li key={item.id}>
          <strong>{item.label}</strong>
          <p>{item.detail}</p>
          {item.citations.map((c, index) => (
            <div key={index}>
              <button
                className="bpv-link"
                disabled={!sourceCurrent || item.stale}
                onClick={() => onSource(c.startLine, c.path)}
              >
                {c.path}:{c.startLine} · Source
              </button>
              {c.quote && <blockquote>{c.quote}</blockquote>}
            </div>
          ))}
        </li>
      )}
    />
  );
  return (
    <section className="bpcm" aria-label="Component overview">
      <style>{componentStyles}</style>
      <h3>What this source does</h3>
      <p>
        Start with a responsibility, follow its relationships, then inspect the
        supporting source.
      </p>
      <p className="bpv-muted">
        {mapped.length} source-bound components · {map.unassigned.length}{" "}
        unassigned files · {map.ambiguous.length} shared files.{" "}
        {map.partial && "Some source files were not checked. "}Purpose and
        ownership are inferred; execution is not established.
      </p>
      {!sourceCurrent && (
        <p role="status">
          This overview uses the saved inspection. Source freshness is
          unconfirmed or changed; source links are disabled until checked.
        </p>
      )}
      {!map.components.length ? (
        <div className="bpg-empty">
          <h4>Responsibilities have not been mapped</h4>
          <p>
            The files have been read, but files alone do not explain the system.
            Describe the parts in Planning chat. No
            components or relationships are invented from folder names.
          </p>
        </div>
      ) : (
        <div className="bpcm-layout">
          <label className="bpcm-picker">
            Responsibility
            <select
              value={component?.id ?? ""}
              onChange={(e) => choose(e.target.value)}
            >
              {map.components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.paths.length ? "" : " · unmapped"}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Component responsibilities">
            <label>
              Find a responsibility
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <ul className="bpcm-components">
              {[...matching]
                .sort(
                  (a, b) => Number(!!b.paths.length) - Number(!!a.paths.length),
                )
                .slice(page * 20, (page + 1) * 20)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      aria-pressed={component?.id === c.id}
                      onClick={() => choose(c.id)}
                    >
                      <strong>{c.title}</strong>
                      <span>
                        {c.paths.length
                          ? `${c.paths.length} mapped files`
                          : basis(c)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
            {!matching.length && (
              <p>
                No matching responsibility. Try a component name or source path.
              </p>
            )}
            {matching.length > 20 && (
              <div className="bpc-controls">
                <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  Previous components
                </button>
                <span>
                  {page + 1} / {Math.ceil(matching.length / 20)}
                </span>
                <button
                  disabled={(page + 1) * 20 >= matching.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next components
                </button>
              </div>
            )}
          </nav>
          {component && (
            <article
              className="bpcm-detail"
              aria-label="Component responsibility"
              key={component.id}
            >
              <h3 ref={heading} tabIndex={-1}>
                {component.title}
              </h3>
              <p className="bpv-muted">{basis(component)}</p>
              <p className="bpcm-responsibility">
                {component.responsibility || "Responsibility is not recorded."}
              </p>
              <dl className="bpcm-contract">
                {[
                  ["Receives", component.inputs],
                  ["Produces", component.outputs],
                  ["State", component.state],
                ].map(([label, values]) => (
                  <div key={label as string}>
                    <dt>{label}</dt>
                    <dd>
                      {(values as string[]).length ? (
                        <ul>
                          {(values as string[]).map((v, i) => (
                            <li key={i}>{v}</li>
                          ))}
                        </ul>
                      ) : (
                        "Not described"
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {onRecord && (
                <button onClick={() => onRecord(component.id)}>
                  Open record and statement evidence
                </button>
              )}
              <section aria-label="Component relationships">
                <h4>Why it connects</h4>
                {!related.length && (
                  <p>
                    No uniquely mapped relationship is available for this
                    component. Unmapped, shared and historical source stays in
                    the gaps below; this does not prove independence.
                  </p>
                )}
                {related.map((r) => (
                  <article className="bpcm-relationship" key={r.id}>
                    <p className="bpcm-direction">
                      <button
                        className="bpv-link"
                        onClick={() => choose(r.from)}
                      >
                        {title(r.from)}
                      </button>
                      <span aria-label="depends on or sends to">→</span>
                      <button className="bpv-link" onClick={() => choose(r.to)}>
                        {title(r.to)}
                      </button>
                    </p>
                    {r.purposes.length ? (
                      <>
                        {r.purposes.map((p) => (
                          <div key={p.id}>
                            <h5>{p.label}</h5>
                            <p>{p.detail}</p>
                          </div>
                        ))}
                        <p className="bpv-muted">
                          Inferred purpose · {r.references.length} static source
                          references. Explanations remain separate claims, not
                          verified flow.
                        </p>
                        <details>
                          <summary>
                            Evidence for the purpose ({r.purposes.length})
                          </summary>
                          {refs(r.purposes)}
                        </details>
                      </>
                    ) : (
                      <>
                        <h5>Purpose not explained</h5>
                        <p>
                          Source references cross these component mappings, but
                          no cited explanation says why. Inspect the references
                          before interpreting the dependency.
                        </p>
                      </>
                    )}
                    {!!r.references.length && (
                      <details>
                        <summary>
                          Inspect {r.references.length} static references
                        </summary>
                        {refs(r.references)}
                      </details>
                    )}
                  </article>
                ))}
              </section>
              <details>
                <summary>
                  Source files and mapping gaps (
                  {component.proposedPaths.length})
                </summary>
                <ul>
                  {component.proposedPaths.map((path) => (
                    <li key={path}>
                      <button
                        className="bpv-link"
                        disabled={!map.inspectedPaths.includes(path)}
                        onClick={() => onFile(path)}
                      >
                        {path}
                      </button>
                      {!component.paths.includes(path) &&
                        " · not bound to this inspection"}
                    </li>
                  ))}
                </ul>
                <ul>
                  {component.gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
                {component.citations.map((c, i) => (
                  <details key={i}>
                    <summary>
                      {c.path}:{c.startLine} · Saved citation
                    </summary>
                    <blockquote>{c.quote ?? "No quote retained."}</blockquote>
                  </details>
                ))}
              </details>
              <details>
                <summary>
                  References within this component (
                  {
                    map.internal.filter((i) => i.component === component.id)
                      .length
                  }
                  )
                </summary>
                <p>
                  Internal references stay with the responsibility that owns
                  both files; they do not become separate overview arrows.
                </p>
                {refs(
                  map.internal
                    .filter((i) => i.component === component.id)
                    .map((i) => i.connection),
                )}
              </details>
            </article>
          )}
        </div>
      )}
      <details className="bpcm-gaps">
        <summary>Coverage and unresolved relationships</summary>
        <p>
          {map.exclusions} scan exclusions ·{" "}
          {map.components.filter((c) => !c.paths.length).length} components
          without a source binding · {map.unplaced.length} unassigned
          relationships · {map.historical.length} historical relationships ·{" "}
          {map.unresolved.length} imports without an inspected target.
        </p>
        <details>
          <summary>Unassigned source files ({map.unassigned.length})</summary>
          <PagedList
            items={map.unassigned}
            label="Unassigned file pages"
            render={(path) => (
              <li key={path}>
                <button className="bpv-link" onClick={() => onFile(path)}>
                  {path}
                </button>
              </li>
            )}
          />
        </details>
        <details>
          <summary>Shared source files ({map.ambiguous.length})</summary>
          <p>
            A shared file is not assigned to an arbitrary component. Narrow the
            mapping before interpreting its connections.
          </p>
          <PagedList
            items={map.ambiguous}
            label="Shared file pages"
            render={(a) => (
              <li key={a.path}>
                {a.path}: {a.components.map(title).join(", ")}
              </li>
            )}
          />
        </details>
        <details>
          <summary>Unassigned relationships ({map.unplaced.length})</summary>
          <PagedList
            items={map.unplaced}
            label="Unassigned relationship pages"
            render={({ connection: c, reason }) => (
              <li key={c.id}>
                {c.from} → {c.to}: {c.label}. {reason}{" "}
                <button className="bpv-link" onClick={() => onFile(c.from)}>
                  Inspect file relationships
                </button>
              </li>
            )}
          />
        </details>
        <details>
          <summary>Historical relationships ({map.historical.length})</summary>
          {refs(map.historical.map((c) => ({ ...c, stale: true })))}
        </details>
        <details>
          <summary>
            Imports without an inspected target ({map.unresolved.length})
          </summary>
          <PagedList
            items={map.unresolved}
            label="Unresolved import pages"
            render={(i, index) => (
              <li key={index}>
                {i.path}:{i.line} → {i.specifier} · {i.resolution}
              </li>
            )}
          />
        </details>
      </details>
    </section>
  );
}

const componentStyles = `
.bpcm { min-width:0; }
.bpcm p, .bpcm li, .bpcm dd, .bpcm h3, .bpcm h5 { overflow-wrap:anywhere; }
.bpv .bpcm, .bpv .bpcm p { font-size:15px; }
.bpcm-picker { display:none; }
.bpcm-layout { display:grid; grid-template-columns:minmax(190px, 1fr) minmax(0, 2.6fr); gap:24px; margin-block:24px; }
.bpcm nav label { display:grid; gap:8px; }
.bpcm input, .bpcm select { min-width:0; width:100%; box-sizing:border-box; font:inherit; padding:10px; min-height:44px; color:inherit; background:var(--paper); border:1px solid var(--hair-2); border-radius:0; }
.bpv .bpcm-components { list-style:none; margin:16px 0; padding:0; }
.bpcm-components li + li { border-top:1px solid var(--hair); }
.bpv .bpcm-components button { width:100%; text-align:left; display:grid; gap:6px; border:0; border-radius:0; padding:14px 10px; background:transparent; }
.bpv .bpcm-components button[aria-pressed=true] { background:var(--paper); color:var(--ink); font-weight:600; outline:1.5px solid var(--ink); outline-offset:-1.5px; }
.bpcm-components span { font-size:13px; color:var(--ink-2); }
.bpcm-detail h3 { margin-top:0; font-size:22px; }
.bpcm-detail h4 { margin:28px 0 12px; font-size:18px; }
.bpcm-detail h5 { margin:12px 0 8px; font-size:16px; }
.bpcm-detail p { max-width:72ch; line-height:1.55; }
.bpcm-contract { margin:24px 0; }
.bpcm-contract > div { display:grid; grid-template-columns:90px minmax(0,1fr); gap:12px; margin-block:12px; }
.bpcm-contract dt { font-weight:600; }
.bpcm-contract dd { margin:0; }
.bpcm-contract ul { margin:0; padding-left:20px; }
.bpcm-relationship { border-top:1px solid var(--hair); padding:12px 0 20px; }
.bpcm-direction { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.bpcm .bpcm-direction button { font-weight:600; text-align:left; }
.bpcm summary { cursor:pointer; padding:12px 0; min-height:20px; }
.bpv .bpcm .bpv-link { min-height:44px; }
.bpcm-evidence { padding-left:20px; }
.bpcm-evidence > li { margin:16px 0; }
.bpcm blockquote { margin:12px 0; padding:10px 12px; border:1px solid var(--hair-2); white-space:pre-wrap; overflow-wrap:anywhere; }
.bpcm-gaps { border-top:1px solid var(--ink); margin-top:28px; }
@media(max-width:700px) {
  .bpv .bpcm, .bpv .bpcm p { font-size:16px; }
  .bpcm-layout > nav { display:none; }
  .bpcm-picker { display:grid; gap:8px; }
  .bpcm-layout { grid-template-columns:minmax(0,1fr); gap:20px; }
  .bpcm-components { max-height:240px; overflow-y:auto; border-bottom:1px solid var(--hair); }
  .bpcm-contract > div { grid-template-columns:minmax(0,1fr); gap:4px; }
  .bpcm-detail { border-top:1px solid var(--ink); padding-top:20px; }
}
`;

import React from "react";
import type { CodeFile, CodeSnapshot } from "../contracts/code.ts";

const languageNames: Record<string, string> = {
  typescript: "JavaScript / TypeScript",
  "web-assets": "HTML / CSS / Markdown",
  "package-json": "package.json",
};

export function LanguageCapabilities({ snapshot }: { snapshot: CodeSnapshot }) {
  if (!snapshot.analysis)
    return (
      <p>
        Earlier analysis record. Its original coverage is retained; refresh code
        to obtain current language capabilities.
      </p>
    );
  return (
    <details className="bpc-language">
      <summary>Language capabilities and tools</summary>
      {snapshot.analysis.adapters.map((a) => (
        <section key={a.id} aria-label={`${a.id} capabilities`}>
          <h3>{languageNames[a.id] ?? a.id}</h3>
          <p>
            {a.files} files · {a.tool} {a.toolVersion} · adapter {a.version}
          </p>
          <dl>
            {Object.entries(a.capabilities).map(([name, c]) => (
              <React.Fragment key={name}>
                <dt>
                  {name === "syntax"
                    ? "Declarations"
                    : name === "imports"
                      ? "Local imports"
                      : name === "relationships"
                        ? "Static relationships"
                        : name === "architecture"
                          ? "Dependency rules"
                          : "Scopes"}
                  : {c.status}
                </dt>
                <dd>{c.detail}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ))}
      {snapshot.analysis.gaps.map((g) => (
        <p key={g}>{g}</p>
      ))}
      <p>
        Source and tool versions belong to this saved inspection. Refresh after
        source, dependency configuration or tool changes. Static references do
        not prove runtime execution.
      </p>
    </details>
  );
}
export function LanguageFacts({
  file,
  open,
}: {
  file: CodeFile;
  open: (line: number, path?: string) => void;
}) {
  const a = file.analysis;
  if (!a) return null;
  return (
    <details>
      <summary>Language facts and unresolved targets</summary>
      <p>
        {a.tool} {a.toolVersion} · {a.capabilities.syntax.status} ·{" "}
        {a.scopes.length} scopes · {a.symbols.length} declarations ·{" "}
        {a.relationships.length} static relationships
      </p>
      {a.gaps.map((g) => (
        <p key={g}>{g}</p>
      ))}
      <details>
        <summary>Declarations and their scopes</summary>
        <ul>
          {a.symbols.slice(0, 100).map((s) => (
            <li key={s.id}>
              <button
                className="bpv-link"
                onClick={() => open(s.range.startLine)}
              >
                {s.name} · {s.kind} · line {s.range.startLine}
              </button>
              <p>
                Scope:{" "}
                {a.scopes.find((scope) => scope.id === s.scope)?.name ??
                  "unavailable"}
              </p>
            </li>
          ))}
        </ul>
        {a.symbols.length > 100 && (
          <p>
            Showing the first 100 declarations; the project chat can inspect the
            bounded file facts.
          </p>
        )}
      </details>
      <ul>
        {a.relationships.slice(0, 100).map((r, i) => (
          <li key={i}>
            <button
              className="bpv-link"
              onClick={() => open(r.range.startLine)}
            >
              {r.spelling} · line {r.range.startLine}
            </button>
            <p>
              {r.kind} · {r.resolution}
              {r.target && (
                <>
                  {" "}
                  ·{" "}
                  <button
                    className="bpv-link"
                    onClick={() =>
                      open(r.target!.range.startLine, r.target!.path)
                    }
                  >
                    {r.target.path}:{r.target.range.startLine}
                  </button>
                </>
              )}
            </p>
            {r.reason && <p>{r.reason}</p>}
          </li>
        ))}
      </ul>
      {a.relationships.length > 100 && (
        <p>
          Showing the first 100 relationships. Narrow the scan folder or use the
          project chat to inspect file facts.
        </p>
      )}
      <p>
        Ranges use one-based lines and zero-based UTF-8 byte columns.
        Provenance: adapter {a.adapterVersion}; source {a.source.slice(0, 12)};
        context {a.context.slice(0, 12)}.
      </p>
    </details>
  );
}

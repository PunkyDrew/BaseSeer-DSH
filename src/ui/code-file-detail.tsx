// Selected source file panel, split from code-view.tsx. Moved verbatim.
import React from "react";
import type { CodeFile } from "../contracts/code.ts";
import type { connectionNeighborhood } from "../contracts/source-connections.ts";
import type { connectionDetailGroups } from "./connection-groups.ts";
import { ConnectionDetails } from "./connection-details.tsx";
import { LanguageFacts } from "./language-capabilities.tsx";

// What the inspection established for this file, in plain words.
export function coverageLabel(file: CodeFile) {
  if (file.coverage === "syntax")
    return "Observed syntax; not type-checked or executed.";
  return file.coverage === "parse-error"
    ? "Parse errors: extracted declarations/imports may be incomplete."
    : "Source reading only; language analysis is unsupported.";
}

export function SourceFileDetail({
  file,
  projectMode,
  neighborhood,
  detailGroups,
  connectionId,
  focused,
  setConnectionId,
  fresh,
  showSource,
  onClose,
}: {
  file: CodeFile;
  projectMode: boolean;
  neighborhood: ReturnType<typeof connectionNeighborhood> | null;
  detailGroups: ReturnType<typeof connectionDetailGroups>;
  connectionId: string;
  focused: string;
  setConnectionId: (id: string) => void;
  fresh: string;
  showSource: (at?: number, name?: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <aside className="bpv-detail" aria-label="Selected source file">
      <button onClick={onClose}>Close source details</button>
      <h2>{file.path}</h2>
      <p>
        {file.language} · {file.lines} lines · {file.bytes} bytes
      </p>
      <LanguageFacts
        file={file}
        open={(line, path) => void showSource(line, path ?? file.path)}
      />
      <p className="bpv-muted">{coverageLabel(file)}</p>
      <button onClick={() => void showSource()}>Read inspected source</button>
      {projectMode && neighborhood && (
        <section aria-label="Module connections">
          <h3>Connections</h3>
          <ConnectionDetails
            groups={detailGroups}
            selected={connectionId}
            focused={focused}
            onSelect={setConnectionId}
            onSource={(line, path) => void showSource(line, path)}
            sourceChanged={fresh === "stale"}
          />
          <p>
            {neighborhood.unresolved.length} unresolved or external imports.
            Their destinations have not been checked. See Imports below.
          </p>
        </section>
      )}
      <h3>Declarations</h3>
      {file.declarations.length ? (
        <ul>
          {file.declarations.map((d) => (
            <li key={`${d.name}:${d.line}`}>
              <button
                className="bpv-link"
                onClick={() => void showSource(d.line)}
              >
                {d.name} · {d.kind} · line {d.line}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No supported top-level declarations found; this is not proof of no
          behavior.
        </p>
      )}
      <h3>Imports</h3>
      <details>
        <summary>Call sites · syntax only ({file.calls?.length ?? 0})</summary>
        <p className="bpv-muted">
          Call spellings are observed. Names can be shadowed; receiver types and
          runtime dispatch are not resolved.
        </p>
        <ul>
          {file.calls?.map((c, i) => (
            <li key={i}>
              <button
                className="bpv-link"
                onClick={() => void showSource(c.line)}
              >
                {c.caller} → {c.callee} · line {c.line}
              </button>
              <p className="bpv-muted">{c.resolution}</p>
            </li>
          ))}
        </ul>
      </details>
      {file.imports.length ? (
        <ul>
          {file.imports.map((i, index) => (
            <li key={index}>
              <button
                className="bpv-link"
                onClick={() => void showSource(i.line)}
              >
                {i.specifier} · line {i.line}
              </button>
              <p className="bpv-muted">
                {i.kind} ·{" "}
                {i.resolution === "local"
                  ? `project-local target: ${i.target}`
                  : i.resolution === "external"
                    ? "bare/external specifier; installation and aliases not checked"
                    : "unresolved target"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No supported literal imports found; dynamic dependencies may be
          missing.
        </p>
      )}
      <p className="bpv-muted">
        Content SHA-256: <code>{file.sha256}</code>. No plan mapping or
        correctness assessment is implied.
      </p>
    </aside>
  );
}

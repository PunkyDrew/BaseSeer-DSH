// Source preview, coverage and project-baseline panels, split from code-view.tsx. Moved verbatim.
import React from "react";
import type { CodeSnapshot } from "../contracts/code.ts";
import type { MapStatus, ScanProgress } from "../contracts/project-map.ts";
import { LanguageCapabilities } from "./language-capabilities.tsx";

export function SourcePreview({
  source,
  fresh,
  line,
}: {
  source: { path: string; content: string; sha256: string };
  fresh: string;
  line: number;
}) {
  return (
    <section className="bpc-source" aria-label="Inspected source content">
      <h3>{source.path}</h3>
      <p className="bpv-muted">
        {fresh === "current"
          ? "Bytes matched the selected inspection when opened."
          : "Historical source preview — refresh before treating it as current."}{" "}
        Read-only preview.
      </p>
      <pre tabIndex={0}>
        {source.content.split(/\r?\n/).map((value, index) => (
          <span
            key={index}
            id={`code-line-${index + 1}`}
            data-selected={line === index + 1}
          >
            <span className="bpc-line-number">{index + 1}</span>
            {value}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}

export function CoverageDetails({
  snapshot,
  omissionPage,
  setOmissionPage,
}: {
  snapshot: CodeSnapshot;
  omissionPage: number;
  setOmissionPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <details id="code-coverage">
      <summary>Analysis coverage, exclusions and evidence limits</summary>
      <p>
        {snapshot.analyzer} · inspection {snapshot.digest.slice(0, 12)}
      </p>
      <LanguageCapabilities snapshot={snapshot} />
      <ul>
        {snapshot.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <p>
        Blue nodes have supported syntax; dashed nodes have source-only
        coverage; amber nodes have parse errors. File size and declaration
        counts are measurements, not “god file” verdicts.
      </p>
      <ul>
        {snapshot.omissions
          .slice(omissionPage * 100, (omissionPage + 1) * 100)
          .map((omission, index) => (
            <li key={index}>
              {omission.path}: {omission.reason}
            </li>
          ))}
      </ul>
      {snapshot.omissions.length > 100 && (
        <p>
          <button
            disabled={!omissionPage}
            onClick={() => setOmissionPage((p) => p - 1)}
          >
            Previous exclusions
          </button>{" "}
          <button
            disabled={(omissionPage + 1) * 100 >= snapshot.omissions.length}
            onClick={() => setOmissionPage((p) => p + 1)}
          >
            Next exclusions
          </button>{" "}
          Page {omissionPage + 1} of{" "}
          {Math.ceil(snapshot.omissions.length / 100)}
        </p>
      )}
    </details>
  );
}

export function ProjectBaseline({
  mapState,
  progress,
  fresh,
  chooseFile,
  showSource,
  onPlan,
}: {
  mapState: MapStatus | null;
  progress: ScanProgress | undefined;
  fresh: string;
  chooseFile: (path: string) => void;
  showSource: (at?: number, name?: string) => Promise<void>;
  onPlan: (() => void) | undefined;
}) {
  return (
    <details className="bpc-project" aria-label="Existing project baseline">
      <summary>
        Source details · {mapState?.explanations.length ?? 0} inferred
        explanations · baseline and scan coverage
      </summary>
      <p>
        Observed source is the starting point. Architecture explanations remain
        inferred; Planning records future changes separately.
      </p>
      <details>
        <summary>Scan folder and source baseline</summary>
        <p className="bpv-muted">
          Leave blank for the whole project, or enter a relative folder to
          inspect a smaller area. Scanning does not change project files or run
          project scripts.
        </p>
        {mapState?.baseline && (
          <p>
            First source check: {mapState.baseline.files} files read
            {mapState.baseline.partial ? " · partial coverage" : ""} ·{" "}
            {new Date(mapState.baseline.checkedAt).toLocaleString()}. Retained
            across project sessions.
          </p>
        )}
      </details>
      {progress && (
        <p role="status">
          {progress.phase === "analyzing"
            ? "Analyzing languages"
            : "Reading source"}{" "}
          · {progress.files} files · {progress.visited} entries ·{" "}
          {progress.path}
        </p>
      )}
      {mapState?.changes && (
        <details>
          <summary>Changes since the initial source baseline</summary>
          {!mapState.changes.comparable ? (
            <p>{mapState.changes.reason}</p>
          ) : (
            <>
              <p>
                {mapState.changes.added.length} added ·{" "}
                {mapState.changes.changed.length} changed ·{" "}
                {mapState.changes.unavailable.length} unavailable
                {mapState.changes.contextChanged
                  ? " · Git context changed"
                  : ""}
              </p>
              <p>{mapState.changes.reason} Planning records are unchanged.</p>
              {(["added", "changed", "unavailable"] as const).map((kind) => (
                <p key={kind}>
                  {kind}: {mapState.changes![kind].join(", ") || "None"}
                </p>
              ))}
            </>
          )}
        </details>
      )}
      <details>
        <summary>Source-backed architecture explanations</summary>
        <p>
          Ask the project’s chat to explain a component or plan a change.
          Explanations cite inspected source and remain inferences; quoted
          source is checked, but the explanation itself is not verified.
        </p>
        {mapState?.explanations?.map((explanation: any) => (
          <article key={explanation.id}>
            <h3>{explanation.title}</h3>
            <p className="bpv-muted">
              Inferred ·{" "}
              {explanation.stale || fresh !== "current"
                ? "Source context needs rechecking"
                : "Citations match this scan"}
            </p>
            <p>{explanation.explanation}</p>
            <ul>
              {explanation.sources.map((ref: any, index: number) => (
                <li key={index}>
                  <button
                    className="bpv-link"
                    disabled={explanation.stale}
                    onClick={() => {
                      chooseFile(ref.path);
                      void showSource(ref.startLine, ref.path);
                    }}
                  >
                    {ref.path}:{ref.startLine}–{ref.endLine}
                  </button>
                  {explanation.stale && (
                    <>
                      <p>
                        Historical citation; refresh the explanation before
                        using this location for current source.
                      </p>
                      <blockquote>{ref.quote}</blockquote>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </details>
      <button onClick={onPlan}>Discuss architecture or plan a change</button>
    </details>
  );
}

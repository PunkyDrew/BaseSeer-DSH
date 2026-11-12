import React, { useEffect, useRef, useState } from "react";
import type { SourceRequest } from "./source-view.tsx";
import { StatementEvidence } from "./statement-evidence.tsx";
import { PlanCoverageView } from "./plan-coverage-view.tsx";
import { codeCheckCopy } from "./code-check-copy.ts";
import {
  reviewSummary,
  reviewState,
  reviewLastCheck,
} from "./review-summary.ts";

/** The Review page: the plan next to the code that exists, and the checks of the code against the plan. */
export function ReviewView({
  active = true,
  call,
  sessionId,
  projectMode,
  refreshKey,
  onSelect,
  onOpenSource,
}: {
  active?: boolean;
  call: (op: string, payload: unknown) => Promise<any>;
  sessionId: string;
  projectMode: boolean;
  refreshKey: unknown;
  onSelect: (id: string) => void;
  onOpenSource: (request: SourceRequest, origin: HTMLElement) => void;
}) {
  const [review, setReview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(0),
    pending = useRef(false);
  const load = async (action = "read") => {
    if (pending.current) return;
    pending.current = true;
    const token = ++request.current;
    setBusy(true);
    try {
      const value = await call("session-review", {
        session: sessionId,
        command: { action },
      });
      if (token === request.current) {
        setReview(value);
        setError("");
      }
    } catch (e) {
      if (token === request.current) setError(String(e));
    } finally {
      if (token === request.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      request.current++;
      pending.current = false;
      clearInterval(timer);
    };
  }, [sessionId, active]);
  const summary = review && reviewSummary(review);
  const lastCheck = review && reviewLastCheck(review);
  return (
    <section aria-label="Code review" className="bpv-group">
      {projectMode && (
        <PlanCoverageView
          call={call}
          sessionId={sessionId}
          active={active}
          refreshKey={refreshKey}
          onRecord={onSelect}
        />
      )}
      <h2>Built and checked</h2>
      <div className="bpv-actions">
        <button disabled={busy} onClick={() => void load("inspect")}>
          Check the code again
        </button>
        <button disabled={busy} onClick={() => void load()}>
          Refresh results
        </button>
      </div>
      {error && (
        <p role="alert" className="bpv-error">
          Could not check the code. Try again. {error}
        </p>
      )}
      {busy && (
        <p role="status">
          Checking the code…{review ? " Last results shown below." : ""}
        </p>
      )}
      {review && summary && (
        <>
          <p>{summary.headline}</p>
          <p className="bpv-muted">
            {lastCheck.label}
            {lastCheck.check && (
              <>
                {" "}
                ·{" "}
                <button onClick={() => onSelect(lastCheck.check.id)}>
                  View check details
                </button>
              </>
            )}
          </p>
          {!!summary.paths.length && (
            <>
              <p>
                {summary.uncertain
                  ? "Some files were skipped. Check the skipped files below before deciding what is missing."
                  : "Tell the planner to build, then check the code again."}
              </p>
              <details>
                <summary>Planned files ({summary.paths.length})</summary>
                <ul>
                  {summary.paths.map((path: string) => (
                    <li key={path}>
                      <code>{path}</code>
                      {summary.missing
                        .filter((c: any) => c.path === path)
                        .map((c: any, i: number) => (
                          <React.Fragment key={i}>
                            {" "}
                            <button onClick={() => onSelect(c.subject)}>
                              View{" "}
                              {review.architecture.modules?.find(
                                (m: any) => m.id === c.subject,
                              )?.title ?? "planned part"}
                            </button>
                          </React.Fragment>
                        ))}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {(!!summary.concerns.length || !!review.findings.length) && (
            <h3>Needs attention</h3>
          )}
          {summary.concerns.map((c: any, i: number) => (
            <article className="bpv-entry" key={i}>
              <strong>{reviewState(c.assessment)}</strong>
              <p>{c.description}</p>
              {c.path && (
                <p>
                  <code>
                    {c.path}
                    {c.line ? `:${c.line}` : ""}
                  </code>
                </p>
              )}
              {c.subject && (
                <button onClick={() => onSelect(c.subject)}>
                  View planned part
                </button>
              )}
            </article>
          ))}
          {review.findings.map((f: any) => (
            <article className="bpv-entry" key={f.id}>
              <button className="bpv-link" onClick={() => onSelect(f.id)}>
                {f.title}
              </button>
              <p>{f.data.description}</p>
              <p>{f.data.resolution}</p>
              {f.binding && (
                <p className="bpv-muted">
                  {f.binding.current
                    ? "Applies to the current code"
                    : "Saved finding — check whether it still applies"}
                </p>
              )}
            </article>
          ))}
          {!!summary.modules.length && (
            <>
              <h3>Do the parts match the plan?</h3>
              <details>
                <summary>What this checks</summary>
                <p>
                  Checks whether each part's files exist and whether their
                  imports use only the planned dependencies. Cohesion means its
                  responsibilities belong together; coupling means how much it
                  depends on other parts. Dependency checks do not test how the
                  app behaves.
                </p>
                <p>{review.architecture.coverage}</p>
              </details>
              {summary.modules.map((module: any) => (
                <details className="bpv-entry" key={module.id}>
                  <summary>
                    {module.title} · {reviewState(module.assessment)}
                  </summary>
                  <p>
                    <strong>Does:</strong> {module.responsibility}
                  </p>
                  <p>
                    May use:{" "}
                    {module.allowedDependencies
                      .map((d: any) => d.title)
                      .join(", ") || "No other planned parts"}
                    .
                  </p>
                  {!!module.rules.length && (
                    <ul>
                      {module.rules.map((rule: any, i: number) => (
                        <li key={i}>
                          {rule.description} {reviewState(rule.availability)}.
                        </li>
                      ))}
                    </ul>
                  )}
                  {module.observed && (
                    <p>Found in: {module.observed.paths.join(", ")}</p>
                  )}
                  {module.sources.map((file: any) => (
                    <section key={file.path}>
                      <h4>
                        {file.path} ·{" "}
                        {file.availability === "observed"
                          ? reviewState(file.coverage)
                          : "Not found"}
                      </h4>
                      {file.availability === "observed" && (
                        <button
                          onClick={(event) =>
                            onOpenSource(
                              {
                                kind: "current",
                                title: module.title,
                                path: file.path,
                                digest: review.code.digest,
                              },
                              event.currentTarget,
                            )
                          }
                        >
                          Open code
                        </button>
                      )}
                      <ul>
                        {file.dependencies.map((d: any, i: number) => (
                          <li key={i}>
                            Line {d.line}: uses {d.specifier}
                            {d.modules.length
                              ? ` (${d.modules.map((m: any) => m.title).join(", ")})`
                              : ""}
                            {d.resolution === "unresolved"
                              ? " — target not found"
                              : ""}
                          </li>
                        ))}
                      </ul>
                      {!file.dependencies.length && (
                        <p>
                          {file.coverage === "syntax"
                            ? "No imports found."
                            : "Imports not fully checked."}
                        </p>
                      )}
                    </section>
                  ))}
                  {!!module.gaps.length && (
                    <ul>
                      {module.gaps.map((gap: string) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  )}
                  <button onClick={() => onSelect(module.id)}>
                    View planned part
                  </button>
                </details>
              ))}
            </>
          )}
          {!!review.supportedRecords?.length && (
            <details>
              <summary>Parts found in existing code</summary>
              {review.supportedRecords.map((r: any) => (
                <section key={r.id}>
                  <button className="bpv-link" onClick={() => onSelect(r.id)}>
                    {r.title}
                  </button>
                  <StatementEvidence support={r} onOpenSource={onOpenSource} />
                </section>
              ))}
            </details>
          )}
          {!!review.mappings.length && <h3>Saved code links</h3>}
          {review.mappings.map((m: any) => (
            <p key={m.id}>
              <button
                className="bpv-link"
                onClick={(event) =>
                  onOpenSource(
                    {
                      kind: "snapshot",
                      title: m.title,
                      path: m.data.path,
                      digest: review.snapshots.find(
                        (s: any) => s.id === m.data.snapshot,
                      )?.data.digest,
                      startLine: m.data.startLine,
                      endLine: m.data.endLine,
                    },
                    event.currentTarget,
                  )
                }
              >
                {m.title} · {m.data.path}:{m.data.startLine}
              </button>{" "}
              · {reviewState(m.freshness)}
              {m.anchor === "invalid source range"
                ? " — saved lines no longer match"
                : m.anchor === "source unavailable for range verification"
                  ? " — saved code unavailable"
                  : ""}
            </p>
          ))}
          {!!lastCheck.evidence.length && <h3>Saved checks</h3>}
          {!review.evidence.length && (
            <p>
              Not checked yet. Check the code above, or run the planned tests in
              Build.
            </p>
          )}
          {lastCheck.evidence.map((e: any) => (
            <details className="bpv-entry" key={e.id}>
              <summary>
                {e.kind === "analysis"
                  ? `Code checked ${codeCheckCopy(e, { records: review.snapshots }).date} · ${reviewState(e.freshness).toLowerCase()}`
                  : `${e.title} · ${reviewState(e.freshness)} · ${reviewState(e.data.assessment ?? e.data.outcome)}`}
              </summary>
              {e.kind === "analysis" ? (
                <p>
                  {
                    Object.keys(
                      review.snapshots.find(
                        (s: any) => s.id === e.data.snapshot,
                      )?.data.files ?? {},
                    ).length
                  }{" "}
                  files inspected. App behavior not tested by this check.
                </p>
              ) : (
                <>
                  <p>{e.data.scope}</p>
                  <pre className="bpc-source">
                    {e.data.statement ??
                      e.data.result ??
                      e.data.gaps?.join("\n")}
                  </pre>
                </>
              )}
              <details>
                <summary>Details</summary>
                <p>
                  Checked with: {e.data.tool}{" "}
                  {e.data.toolVersion ?? e.data.version}
                </p>
                {e.kind === "analysis" && (
                  <ul>
                    {e.data.gaps?.map((gap: string) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                )}
              </details>
              <button onClick={() => onSelect(e.id)}>View check details</button>
            </details>
          ))}
          {(!!review.code.partial || !!review.code.omissions.length) && (
            <details>
              <summary>Files skipped and check limits</summary>
              <ul>
                {review.code.limits.map((l: string) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <ul>
                {review.code.omissions.map((o: any) => (
                  <li key={o.path}>
                    {o.path}: {o.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

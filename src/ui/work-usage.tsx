import React, { useEffect, useState } from "react";

export function WorkUsage({
  active,
  sessionId,
  call,
}: {
  active: boolean;
  sessionId: string;
  call: (op: string, payload: unknown) => Promise<any>;
}) {
  const [report, setReport] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setReport(null);
    setFailed(false);
    const refresh = async () => {
      try {
        const next = await call("session-models", {
          session: sessionId,
          command: { action: "usage" },
        });
        if (!Array.isArray(next?.groups)) throw Error("Unavailable usage");
        if (live) {
          setReport(next);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) timer = setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, sessionId, call]);
  const number = (value: number) => value.toLocaleString();
  return (
    <details className="bpv-work-settings">
      <summary>Token usage and API-equivalent cost</summary>
      {failed ? (
        <p>
          Usage could not be refreshed. Any values below are from the last
          successful refresh.
        </p>
      ) : null}
      {!report ? (
        <p>{failed ? "Current usage unavailable." : "Loading usage…"}</p>
      ) : (
        <>
          <p>
            {number(report.requests)} recorded requests ·{" "}
            {number(report.totalTokens)} reported tokens · $
            {report.knownApiEquivalentUsd.toFixed(4)} USD{" "}
            {report.complete ? "API-equivalent estimate" : "known subtotal"}
          </p>
          {!report.requests ? (
            <p>No requests recorded since usage tracking was enabled.</p>
          ) : null}
          {report.missingUsage ||
          report.unpricedRequests ||
          report.unfinishedRequests ? (
            <p>
              {report.missingUsage} requests without usable token counts;{" "}
              {report.unpricedRequests} without a complete cost estimate;{" "}
              {report.unfinishedRequests} requests still awaiting their final usage.
              Totals remain incomplete.
            </p>
          ) : null}
          {report.groups.length ? (
            <div className="bpv-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Stage / model</th>
                    <th>Uncached input</th>
                    <th>Cached input</th>
                    <th>Cache writes</th>
                    <th>Output</th>
                    <th>API-equivalent USD</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((g: any, i: number) => (
                    <tr key={i}>
                      <td>
                        {g.stage} · {g.provider}/{g.model}
                        {g.purpose ? ` · ${g.purpose}` : ""}
                      </td>
                      <td>{number(g.inputTokens)}</td>
                      <td>{number(g.cacheReadTokens)}</td>
                      <td>{number(g.cacheWriteTokens)}</td>
                      <td>{number(g.outputTokens)}</td>
                      <td>
                        ${g.knownApiEquivalentUsd.toFixed(4)}
                        {g.unpricedRequests ? " (partial)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p>
            Includes recorded repairs and review continuations. Uses the dated
            API reference rates below. Reasoning tokens are included in output.
          </p>
          {[
            ...new Map(
              report.groups.flatMap((g: any) =>
                g.rates.map((r: any) => [JSON.stringify(r), r]),
              ),
            ).values(),
          ].map((r: any, i: number) => (
            <p key={i}>
              <a href={r.source} target="_blank" rel="noreferrer">
                {r.model} rates
              </a>{" "}
              · {r.asOf}: ${r.input} input / ${r.cacheRead} cached /{" "}
              {r.cacheWrite === null
                ? "unpriced cache writes"
                : `$${r.cacheWrite} cache writes`}{" "}
              / ${r.output} output per million tokens. {r.basis}.
              {r.longContextAbove
                ? ` Prompts over ${number(r.longContextAbove)} input tokens use 2× input/cache and 1.5× output rates for the full request.`
                : ""}
            </p>
          ))}
        </>
      )}
    </details>
  );
}

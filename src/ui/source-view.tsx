import React, { useEffect, useRef, useState } from "react";

export type SourceRequest = {
  kind: "snapshot" | "current" | "project";
  path: string;
  digest?: string;
  title: string;
  startLine?: number;
  endLine?: number;
};

// One explicit source navigation owns one request. Late responses cannot replace
// a newer selection, and a missing snapshot never falls back to current bytes.
export function SourceView({
  call,
  sessionId,
  request,
  onClose,
}: {
  call: (op: string, payload: unknown) => Promise<any>;
  sessionId: string;
  request: SourceRequest;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    request: SourceRequest;
    content?: string;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const code = useRef<HTMLPreElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const current = result?.request === request ? result : null;
  const navigation = useRef({ request, attempt, interrupted: false });

  useEffect(() => {
    const intent = { request, attempt, interrupted: false };
    navigation.current = intent;
    const interrupt = () => {
      intent.interrupted = true;
    };
    // Do not pull the reader back after they scroll, tap another control or
    // navigate with the keyboard while the source request is pending.
    const events = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    for (const event of events)
      window.addEventListener(event, interrupt, {
        capture: true,
        passive: true,
      });
    return () => {
      for (const event of events)
        window.removeEventListener(event, interrupt, true);
    };
  }, [request, attempt]);

  useEffect(() => {
    let live = true;
    setResult(null);
    async function read() {
      try {
        if (!request.digest)
          throw new Error("The linked source snapshot is unavailable.");
        const value = await call(
          request.kind === "snapshot"
            ? "session-review"
            : request.kind === "project"
              ? "session-map"
              : "session-code",
          {
            session: sessionId,
            command: {
              action: "source",
              digest: request.digest,
              path: request.path,
            },
          },
        );
        if (live) setResult({ request, content: value.content });
      } catch (error) {
        if (live) setResult({ request, error: String(error) });
      }
    }
    void read();
    return () => {
      live = false;
    };
  }, [call, sessionId, request, attempt]);

  useEffect(() => {
    if (code.current && anchor.current) {
      const top =
        anchor.current.getBoundingClientRect().top -
        code.current.getBoundingClientRect().top;
      code.current.scrollTop += top - 12;
    }
  }, [current]);

  useEffect(() => {
    const intent = navigation.current;
    // Wait until the initiating event and this render have finished. Recheck
    // after loading/error rendering, which can follow host scroll restoration.
    const frame = requestAnimationFrame(() => {
      if (
        intent.interrupted ||
        intent.request !== request ||
        intent.attempt !== attempt
      )
        return;
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, current, attempt]);

  return (
    <section className="bpv-source-view" aria-label="Saved source">
      <h2 ref={heading} tabIndex={-1}>
        {request.path}
      </h2>
      <p>{request.title}</p>
      <p className="bpv-muted">
        {request.kind === "snapshot"
          ? "Saved source snapshot. Current source may differ."
          : "Current inspected source. Changes require a fresh inspection."}
        {request.startLine
          ? ` Mapped lines ${request.startLine}–${request.endLine ?? request.startLine} are highlighted.`
          : ""}
      </p>
      {request.digest && (
        <details>
          <summary>Source revision</summary>
          <p>Snapshot digest: {request.digest}</p>
          <p>
            A source link identifies inspected code; it does not verify
            behavior.
          </p>
        </details>
      )}
      <button onClick={onClose}>Close source</button>
      {!current && <p role="status">Opening source…</p>}
      {current?.error && (
        <div role="alert" className="bpv-error">
          <p>
            Could not open {request.path}. {current.error}
          </p>
          <p>The linked snapshot has not been replaced with another version.</p>
          <button onClick={() => setAttempt((n) => n + 1)}>
            Try opening again
          </button>
        </div>
      )}
      {current?.content !== undefined && (
        <pre
          ref={code}
          className="bpc-source"
          tabIndex={0}
          aria-label="Source code"
        >
          {current.content.split("\n").map((line, i) => (
            <span
              key={i}
              ref={i + 1 === request.startLine ? anchor : undefined}
              data-line={i + 1}
              data-mapped={
                request.startLine &&
                i + 1 >= request.startLine &&
                i + 1 <= (request.endLine ?? request.startLine)
                  ? true
                  : undefined
              }
            >
              {i + 1} {line}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}

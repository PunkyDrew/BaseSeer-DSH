import React, { useEffect, useState } from "react";

type Call = (op: string, payload: unknown) => Promise<any>;

const BUILD: Record<string, string> = {
  running: "Building",
  completed: "Complete",
  stopped: "Stopped",
};

const money = (usd: number) => (usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);
const usageText = (u: any) =>
  u && u.requests
    ? `${u.requests} model request(s) · ${money(u.usd)}${u.unpriced ? ` + ${u.unpriced} unpriced` : ""}`
    : "";

// On the owner's go in the Planning chat, a lead session builds the plan with
// subagents. Progress, the acceptance check and real failures show here.

/** What the next build of a built project changes: the plan's changes since the last completed build. */
function NextBuild({ change }: { change: any }) {
  const since = String(change.since).slice(0, 16).replace("T", " ");
  if (!change.changes.length)
    return <p>Nothing in the plan has changed since the build of {since}.</p>;
  return (
    <div>
      <p>
        <strong>Next build</strong>: what changed in the plan since the build of {since}
      </p>
      <ul>
        {change.changes.map((c: string) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

/** The latest run of BaseSeer's acceptance check, and what it found. */
function AcceptanceCheck({ build }: { build: any }) {
  const runs = build.checks;
  const latest = runs[runs.length - 1];
  const rounds = runs.filter((run: any) => run.failures.length).length;
  if (!latest.failures.length)
    return (
      <p>
        Acceptance check passed
        {rounds ? ` after ${rounds} round(s) of fixes` : ""}.
      </p>
    );
  return (
    <div>
      <p>
        Acceptance check {runs.length} found {latest.failures.length}{" "}
        problem(s):
      </p>
      <ul>
        {latest.failures.map((f: any, i: number) => (
          <li key={i}>{f.summary}</li>
        ))}
      </ul>
    </div>
  );
}

/** Where the review's items fell, beside the usage per model: what each model's work cost and what it left. */
function ReviewPlaces({ places }: { places: any[] }) {
  return (
    <div className="bpv-muted">
      <p>The review's items, by the planned files each names:</p>
      <ul>
        {places.map((p, i) => (
          <li key={i}>
            {p.component
              ? `${p.component.title}, built on ${p.component.route.model} (${p.component.route.thinking})`
              : "No planned file"}
            : {p.items}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The review in its own words and the lead's report: the planner's account
 * of them is a summary of a summary.
 */
function ReviewAndReport({ build }: { build: any }) {
  const fixed: number[] = build.review?.fixed ?? [];
  return (
    <div>
      {fixed.length > 0 && (
        <p>
          The lead fixed review item{fixed.length === 1 ? "" : "s"} {fixed.join(", ")}, and the check passed after
          that.
        </p>
      )}
      {build.review?.report && (
        <details>
          <summary>The review's report, from reading the code and using the program</summary>
          <div className="bpv-report">{build.review.report}</div>
        </details>
      )}
      {build.report && (
        <details>
          <summary>The lead's report</summary>
          <div className="bpv-report">{build.report}</div>
        </details>
      )}
    </div>
  );
}

export function BuildPanel({
  call,
  sessionId,
  active,
  changeVersion,
}: {
  call: Call;
  sessionId: string;
  active: boolean;
  changeVersion: number;
}) {
  const [view, setView] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = (command: any) =>
    call("session-build", { session: sessionId, command });
  useEffect(() => {
    if (!active) return;
    let live = true;
    void request({ action: "overview" })
      .then((v) => live && setView(v))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [sessionId, active, changeVersion]);
  // Builds report through the change stream; poll gently as a fallback.
  useEffect(() => {
    if (!active || view?.build?.status !== "running") return;
    const timer = setInterval(() => {
      void request({ action: "overview" })
        .then(setView)
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [active, view?.build?.status, view?.build?.id]);
  const act = async (command: any) => {
    setBusy(true);
    setError("");
    try {
      await request(command);
      setView(await request({ action: "overview" }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!view) return error ? <p className="bpv-error">{error}</p> : null;
  const plan = view.plan;
  const build = view.build;
  return (
    <section aria-label="Build" className="bpv-build">
      <h2>Build</h2>
      <ol className="bpv-build-order">
        <li>
          <strong>Lead</strong>: when you type /baseseer build in the Planning
          chat (or /baseseer repair, to fix what /baseseer validate found), a
          lead session builds the project in the project folder, with
          subagents on the models the plan gives its components
        </li>
        <li>
          <strong>Acceptance check</strong>: BaseSeer runs the project's
          install, build, lint and tests in a clean copy; what fails goes back
          to the lead and is checked again
        </li>
        <li>
          <strong>Review</strong>: once the check passes, a reviewer reads the
          code against your words, and a use test starts the program the way
          its README tells you to, in a copy of the project, and does your job
          with it; the lead fixes every item they report
        </li>
      </ol>
      {view.change && <NextBuild change={view.change} />}
      {plan.problems?.length > 0 && (
        <div role="alert">
          <p>Before this can build, the plan needs:</p>
          <ul>
            {plan.problems.map((p: string) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.notes?.length > 0 && (
        <details>
          <summary>Notes on this plan</summary>
          <ul>
            {plan.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {build && (
        <div className="bpv-build-run" aria-live="polite">
          <h3>{BUILD[build.status] ?? build.status}</h3>
          <p>{build.reason}</p>
          {build.commands && (
            <p className="bpv-muted">
              Project commands:{" "}
              {Object.entries(build.commands)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
          )}
          {build.usage?.requests > 0 && (
            <div className="bpv-muted">
              <p>
                The lead and its subagents: {usageText(build.usage)}
                (API-equivalent at dated reference rates)
              </p>
              {build.leadUsage?.requests > 0 && <p>The lead: {usageText(build.leadUsage)}</p>}
              <ul>
                {Object.entries(build.usageByModel).map(([model, u]) => (
                  <li key={model}>
                    {model}: {usageText(u)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {build.review?.places.length > 0 && <ReviewPlaces places={build.review.places} />}
          {build.checks?.length > 0 && <AcceptanceCheck build={build} />}
          <ReviewAndReport build={build} />
          <div className="bpv-work-actions">
            {build.status === "running" && (
              <button
                disabled={busy}
                onClick={() => void act({ action: "stop", id: build.id })}
              >
                Stop build
              </button>
            )}
            {build.status === "completed" && !build.committed && (
              <button
                className="bpv-primary"
                disabled={busy}
                onClick={() => void act({ action: "commit", id: build.id })}
              >
                Commit build
              </button>
            )}
          </div>
          {build.status === "completed" && !build.committed && (
            <p className="bpv-muted">
              Commit build makes one commit with the build's files (and the plan
              file) on your current branch, or on a new branch if your branch
              moved since the build started.
            </p>
          )}
          {build.committed && (
            <p>
              Committed {build.committed.files} file(s)
              {build.committed.branch ? ` on ${build.committed.branch}` : ""}
              {build.committed.moved
                ? ". Your branch had moved, so this is a new branch to merge."
                : "."}
            </p>
          )}
          {build.log?.length > 0 && (
            <details>
              <summary>Build log</summary>
              <ul>
                {build.log.slice(-15).map((l: any, i: number) => (
                  <li key={i}>
                    <span className="bpv-muted">
                      {new Date(l.at).toLocaleTimeString()}
                    </span>{" "}
                    {l.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="bpv-error">
          {error}
        </p>
      )}
    </section>
  );
}

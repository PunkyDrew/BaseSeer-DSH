import { codeCheckTime } from "./code-check-copy.ts";
import { friendlyTime } from "./friendly-time.ts";

/** A saved current snapshot is the check, not the subsequent refresh time. */
export function reviewLastCheck(review: any) {
  const checks = (review.evidence ?? []).filter(
    (e: any) => e.kind === "analysis" && e.data.snapshot === review.snapshotId,
  );
  const check = checks.reduce((latest: any, candidate: any) => {
    const time = codeCheckTime(candidate, { records: review.snapshots ?? [] });
    const previous =
      latest && codeCheckTime(latest, { records: review.snapshots ?? [] });
    return !latest ||
      new Date(time ?? "").getTime() > new Date(previous ?? "").getTime()
      ? candidate
      : latest;
  }, undefined);
  const time =
    check && codeCheckTime(check, { records: review.snapshots ?? [] });
  return {
    label: `Last checked ${friendlyTime(time ?? review.code.checkedAt)}${check ? ` · ${reviewState(check.freshness).toLowerCase()}` : ""}`,
    evidence: (review.evidence ?? []).filter((e: any) => !checks.includes(e)),
    check,
  };
}

// Presentation only: retain every analysis result in the response.
export function reviewSummary(review: any) {
  const concerns = review.architecture.concerns;
  const missing = concerns.filter((c: any) => c.kind === "missing");
  const paths: string[] = [...new Set<string>(missing.map((c: any) => c.path))];
  const uncertain = !!review.code.partial || !!review.code.omissions.length;
  const nothingBuilt =
    paths.length > 0 && !review.code.files.length && !uncertain;
  return {
    paths,
    missing,
    uncertain,
    headline: paths.length
      ? `${nothingBuilt ? "Nothing has been built yet. " : ""}${paths.length} planned ${paths.length === 1 ? "file" : "files"} ${uncertain ? "could not be checked" : "don't exist yet"}: ${paths.join(", ")}.`
      : review.code.files.length
        ? `${review.code.files.length} ${review.code.files.length === 1 ? "file" : "files"} checked.`
        : "No code found yet.",
    concerns: concerns.filter(
      (c: any) => !["missing", "coverage"].includes(c.kind),
    ),
    modules: (review.architecture.modules ?? []).filter((m: any) =>
      m.sources.some((s: any) => s.availability === "observed"),
    ),
  };
}

export function reviewState(state: string | undefined): string {
  const labels: Record<string, string> = {
    "not-run": "Not checked yet",
    unsupported: "Cannot check this yet",
    unavailable: "Cannot check this yet",
    inconclusive: "Not fully checked",
    "rule-violation": "Differs from the plan",
    "no-violation-observed": "Matches the plan's dependency rules",
    observation: "Needs review",
    hypothesis: "Needs review",
    current: "Up to date",
    stale: "Code has changed — check again",
    unknown: "Not checked yet",
    completed: "Code inspected",
    partial: "Partly checked",
    passed: "Passed",
    failed: "Failed",
    pass: "Passed",
    fail: "Failed",
    unchecked: "Not checked yet",
    observed: "Found",
    syntax: "Imports checked",
    "stale criteria/design": "Plan has changed — check again",
    "current source; unchecked interpretation":
      "Code found — meaning not checked yet",
    "historical or unrelated source":
      "Saved code differs from the current code",
  };
  return (
    labels[state ?? "unchecked"] ??
    state?.replaceAll("-", " ") ??
    "Not checked yet"
  );
}

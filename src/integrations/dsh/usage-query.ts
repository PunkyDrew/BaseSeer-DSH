import { object, PlanError } from "../../domain/plan.ts";
import { usageReport } from "../../domain/model-usage.ts";
import type { ProjectUsage } from "../../storage/project-local.ts";
import { pageValue } from "./paging.ts";

export function usageQuery(
  storage: ProjectUsage,
  actor: { role: string; plan: string },
  input: unknown,
  clock = Date.now,
) {
  if (!["owner", "planner"].includes(actor.role))
    throw new PlanError(
      "DENIED",
      "Usage requires project owner or planner scope",
    );
  const q = object(input, [
    "action",
    "section",
    "run",
    "since",
    "until",
    "offset",
    "sha256",
    "snapshot",
  ]);
  const section = q.section ?? "summary";
  if (!["summary", "requests"].includes(section as string))
    throw new PlanError("INVALID", "Choose usage summary or requests");
  for (const field of ["since", "until", "offset", "snapshot"])
    if (
      q[field] !== undefined &&
      (!Number.isSafeInteger(q[field]) || (q[field] as number) < 0)
    )
      throw new PlanError("INVALID", `Invalid usage ${field}`);
  const now = clock();
  if (q.snapshot !== undefined && (q.snapshot as number) > now)
    throw new PlanError("INVALID", "Usage snapshot cannot be in the future");
  const live =
    actor.role === "owner" &&
    section === "summary" &&
    q.offset === undefined &&
    q.sha256 === undefined &&
    q.snapshot === undefined;
  const snapshot = live
    ? undefined
    : ((q.snapshot as number | undefined) ?? now);
  if (
    q.since !== undefined &&
    q.until !== undefined &&
    (q.since as number) >= (q.until as number)
  )
    throw new PlanError("INVALID", "Usage until must follow since");
  if (q.run !== undefined && (typeof q.run !== "string" || !q.run))
    throw new PlanError("INVALID", "Use one exact run ID");
  if (
    q.sha256 !== undefined &&
    (typeof q.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(q.sha256))
  )
    throw new PlanError("INVALID", "Use the usage page's exact sha256");
  const rows = storage
    .usage(actor.plan)
    .filter(
      (r) =>
        (q.run === undefined || r.run === q.run) &&
        (q.since === undefined || r.started >= (q.since as number)) &&
        (q.until === undefined || r.started < (q.until as number)) &&
        (snapshot === undefined || r.started < snapshot),
    )
    .map((r) =>
      snapshot !== undefined && (r.ended === undefined || r.ended >= snapshot)
        ? {
            ...r,
            ended: undefined,
            outcome: "started" as const,
            tokens: null,
            invalidUsage: undefined,
          }
        : r,
    );
  const result = section === "requests" ? rows : usageReport(rows);
  if (live) return result;
  const page = pageValue(result, q.offset);
  if (q.sha256 !== undefined && page.sha256 !== q.sha256)
    throw new PlanError(
      "STALE",
      "Usage changed between pages; repeat the first page's snapshot with the same selectors and sha256",
    );
  return page?.encoding === "json-fragment"
    ? {
        ...page,
        snapshot,
        instruction:
          "Repeat snapshot, nextOffset, sha256 and the same usage selectors for every page. This snapshot includes requests started before its timestamp; only requests completed strictly before it have final usage. All other included requests remain unknown. Concatenate one sha256's text to recover the complete JSON.",
      }
    : page;
}

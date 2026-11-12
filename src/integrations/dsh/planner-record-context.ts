import { PlanError, object } from "../../domain/plan.ts";
import { pageValue } from "./paging.ts";
import { toolJson } from "./tool-json.ts";

export function plannerRecordQuery(input: any) {
  if (input?.op !== "read") return { command: input };
  const q = object(input, ["op", "ids", "section", "offset", "sha256"]);
  if (
    q.section !== undefined &&
    !["overview", "records", "full"].includes(q.section as string)
  )
    throw new PlanError(
      "INVALID",
      "Choose overview, records or full for plan context",
    );
  if (
    q.offset !== undefined &&
    (!Number.isSafeInteger(q.offset) || (q.offset as number) < 0)
  )
    throw new PlanError(
      "INVALID",
      "Context offset must be a non-negative safe integer",
    );
  if (
    q.sha256 !== undefined &&
    (typeof q.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(q.sha256))
  )
    throw new PlanError("INVALID", "Use the context page's exact sha256");
  const section = q.section ?? (q.ids === undefined ? "overview" : "records");
  return {
    command: { op: "read", ...(q.ids !== undefined ? { ids: q.ids } : {}) },
    view: {
      section,
      // Records asked for by id come back whole: the planner reads every
      // page of what it asked for, so paging them only adds requests.
      whole: q.ids !== undefined && section === "records",
      offset: q.offset ?? 0,
      sha256: q.sha256,
    },
  };
}

export function plannerRecordContext(value: any, view?: any) {
  if (!view) return value;
  const raw = toolJson(value, "Plan context");
  const selected =
    view.section === "full"
      ? raw
      : view.section === "records"
        ? {
            revision: raw.revision,
            baseline: raw.baseline,
            document: raw.document,
            receipt: raw.receipt,
            coverage: raw.coverage,
          }
        : {
            revision: raw.revision,
            title: raw.title,
            baseline: raw.baseline,
            document: {
              records: raw.document.records.map((r: any) => ({
                id: r.id,
                kind: r.kind,
                title: r.title,
                version: r.version,
                status: r.status,
                state: r.data?.state,
              })),
              links: raw.document.links.map(({ id, from, to, kind }: any) => ({
                id,
                from,
                to,
                kind,
              })),
            },
            proposals: raw.proposals?.map((p: any) => ({
              id: p.id,
              title: p.title,
              status: p.status,
              state: p.state,
              base: p.base,
            })),
            historyCount: raw.history?.length,
            build: raw.build,
            receipt: raw.receipt,
            coverage:
              "Index only. Before changing a record read its exact current data with op read and ids. Batch independent IDs. Read an uninspected initial draft and complete history/baselines/proposals with section full. Follow nextOffset and sha256; partial pages are not complete evidence.",
          };
  if (view.whole) return selected;
  const page = pageValue(selected, view.offset);
  if (view.sha256 !== undefined && page.sha256 !== view.sha256)
    throw new PlanError(
      "STALE",
      "Plan context changed between pages; start again at offset zero",
    );
  return page;
}

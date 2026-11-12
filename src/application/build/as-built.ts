import { createHash } from "node:crypto";
import { canonical, type Document, type PlanningRecord } from "../../domain/records.ts";
import type { ChangeScope, PlanDigest, RecordChange } from "./model.ts";

// What changed in the plan since the last completed build. A build of a
// project already built tells its planner the records added, changed and
// removed since then, and its subagents change the code where the plan
// changed and keep the rest working.

/** The completed build a new build continues. */
export type DeliveredBuild = {
  id: string;
  startedAt: string;
  endedAt: string;
  revision: number;
  builtFrom: PlanDigest;
};

/** Records a build works from; a change to analysis or review records changes no code. */
const BUILT_KINDS = new Set(["component", "interface", "requirement", "scenario", "decision"]);

/**
 * Which model builds what is the planner's to adjust, and changes no code:
 * the decisions that choose models, and each component's model, are left out.
 */
const choosesModels = (r: PlanningRecord) => r.kind === "decision" && (!!r.data.lead || !!r.data.modelPolicy);
const design = ({ build: _build, ...data }: Record<string, unknown>) => data;

const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);

/** A record as the digest keeps it. */
const recordDigest = (r: PlanningRecord) => ({
  kind: r.kind,
  title: r.title,
  hash: hash({ title: r.title, data: design(r.data) }),
});

const linkKey = (l: { kind: string; from: string; to: string }) => `${l.from} ${l.kind} ${l.to}`;

/** The plan as a build starts from it. */
export function digestOf(doc: Document): PlanDigest {
  const records = doc.records.filter((r) => r.status !== "superseded" && BUILT_KINDS.has(r.kind) && !choosesModels(r));
  const ids = new Set(records.map((r) => r.id));
  return {
    records: Object.fromEntries(records.map((r) => [r.id, recordDigest(r)])),
    links: doc.links.filter((l) => ids.has(l.from) && ids.has(l.to)).map(linkKey).sort(),
  };
}

/** Every record and link that differs between the plan a build started from and the plan now. */
function differences(before: PlanDigest, now: PlanDigest): RecordChange[] {
  const changes: RecordChange[] = [];
  for (const [id, record] of Object.entries(now.records)) {
    const earlier = before.records[id];
    if (!earlier) changes.push({ id, kind: record.kind, title: record.title, change: "added" });
    else if (earlier.hash !== record.hash)
      changes.push({ id, kind: record.kind, title: record.title, change: "changed" });
  }
  for (const [id, record] of Object.entries(before.records))
    if (!now.records[id]) changes.push({ id, kind: record.kind, title: record.title, change: "removed" });
  const title = (id: string) => now.records[id]?.title ?? before.records[id]?.title ?? id;
  const link = (key: string, change: RecordChange["change"]): RecordChange => {
    const [from, kind, to] = key.split(" ");
    return { id: key, kind: "link", title: `${title(from)} ${kind} ${title(to)}`, change };
  };
  const linksThen = new Set(before.links);
  const linksNow = new Set(now.links);
  for (const key of now.links) if (!linksThen.has(key)) changes.push(link(key, "added"));
  for (const key of before.links) if (!linksNow.has(key)) changes.push(link(key, "removed"));
  return changes;
}

/** What changed in the plan since the delivered build. */
export function changeScope(doc: Document, delivered: DeliveredBuild): ChangeScope {
  return {
    since: {
      build: delivered.id,
      startedAt: delivered.startedAt,
      endedAt: delivered.endedAt,
      revision: delivered.revision,
    },
    changes: differences(delivered.builtFrom, digestOf(doc)),
  };
}

/** What the next build of a built project builds, for the planner and the Build view. */
export const nextBuildSummary = (scope: ChangeScope) => ({
  since: scope.since.endedAt,
  changes: scope.changes.map((c) => `${c.kind} "${c.title}" ${c.change}`),
});

import { mayUse, type Document, type PlanningRecord } from "../domain/records.ts";
import type { CodeFile, CodeSnapshot } from "./code.ts";

export type ComponentCoverage = {
  id: string;
  title: string;
  /** built: every planned file exists; partial: some do; planned: none yet. */
  state: "built" | "partial" | "planned" | "no-files";
  planned: string[];
  present: string[];
  missing: string[];
  /** Planned components this one's code actually imports. */
  uses: string[];
  /** Imports of other components' code that its contract does not allow. */
  unplannedUses: {
    component: string;
    from: string;
    to: string;
    line: number;
  }[];
};
export type PlanCoverage = {
  digest: string;
  checkedAt: string;
  components: ComponentCoverage[];
  /** Source files no planned component lists. */
  unplanned: string[];
  unplannedCount: number;
  totals: {
    components: number;
    built: number;
    partial: number;
    planned: number;
  };
  limits: string;
};

const live = (r: PlanningRecord) =>
  r.kind === "component" &&
  r.status !== "superseded" &&
  !r.data.c4?.external &&
  r.data.c4?.level !== "person";

// Compares the intended plan with the files that actually exist in the latest
// scan. Presence is observed; whether the code does what the plan says is not.
export function planCoverage(
  doc: Document,
  snapshot: Pick<CodeSnapshot, "digest" | "checkedAt" | "omissions"> & {
    files: Pick<CodeFile, "path" | "imports">[];
  },
): PlanCoverage {
  const files = new Map(snapshot.files.map((f) => [f.path, f]));
  // A planned file the scan saw but did not read, such as a format it has no
  // reader for or a binary file, still exists.
  const exists = new Set([
    ...files.keys(),
    ...snapshot.omissions.map((o) => o.path),
  ]);
  const components = doc.records.filter(live);
  const owner = new Map<string, string>();
  const plannedFor = (c: PlanningRecord): string[] => [
    ...new Set<string>([
      ...(c.data.contract?.sourceTargets ?? []),
      ...(c.data.observed?.paths ?? []),
    ]),
  ];
  for (const c of components)
    for (const f of plannedFor(c)) if (!owner.has(f)) owner.set(f, c.id);
  const byId = new Map(components.map((c) => [c.id, c]));
  const result: ComponentCoverage[] = components.map((c) => {
    const planned = plannedFor(c);
    const present = planned.filter((f) => exists.has(f));
    const missing = planned.filter((f) => !exists.has(f));
    const uses = new Set<string>();
    const unplannedUses: ComponentCoverage["unplannedUses"] = [];
    const hasContract = !!c.data.contract;
    for (const path of present)
      for (const i of files.get(path)?.imports ?? []) {
        if (i.resolution !== "local" || !i.target) continue;
        const target = owner.get(i.target);
        if (!target || target === c.id) continue;
        uses.add(target);
        if (hasContract && !mayUse(c, byId.get(target)!))
          unplannedUses.push({
            component: target,
            from: path,
            to: i.target,
            line: i.line,
          });
      }
    return {
      id: c.id,
      title: c.title,
      state: !planned.length
        ? "no-files"
        : !present.length
          ? "planned"
          : missing.length
            ? "partial"
            : "built",
      planned,
      present,
      missing,
      uses: [...uses].sort(),
      unplannedUses: unplannedUses.slice(0, 40),
    };
  });
  const unplanned = snapshot.files
    .map((f) => f.path)
    .filter((p) => !owner.has(p))
    .sort();
  return {
    digest: snapshot.digest,
    checkedAt: snapshot.checkedAt,
    components: result,
    unplanned: unplanned.slice(0, 200),
    unplannedCount: unplanned.length,
    totals: {
      components: result.filter((c) => c.state !== "no-files").length,
      built: result.filter((c) => c.state === "built").length,
      partial: result.filter((c) => c.state === "partial").length,
      planned: result.filter((c) => c.state === "planned").length,
    },
    limits:
      "Presence and imports come from the latest scan of the real files. They show what exists and how it connects, not whether it behaves as planned.",
  };
}

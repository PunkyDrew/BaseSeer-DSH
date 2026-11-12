import type { Records } from "./records.ts";
import type { ProjectMap } from "./project-map.ts";
import { buildPlan } from "../domain/build-plan.ts";
import { planCoverage } from "../contracts/plan-coverage.ts";

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * A compact, current picture of the workspace for the start of any chat: the
 * planned structure, how much of it exists in the real files, and whether
 * the plan is ready to build. Detail stays behind the plan tools.
 */
export function workspaceSummary(
  records: Records,
  projectMap: ProjectMap,
  plan: string,
) {
  const current = records.store.read(plan);
  const doc = records.doc(plan);
  const counts: Record<string, number> = {};
  for (const r of doc.records)
    if (r.status !== "superseded") counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const saved = projectMap.read(plan);
  const latest = saved.latest;
  const coverage = latest ? planCoverage(doc, latest) : undefined;
  const byComponent = new Map(coverage?.components.map((c) => [c.id, c]));
  const components = doc.records
    .filter(
      (r) =>
        r.kind === "component" &&
        r.status !== "superseded" &&
        !r.data.c4?.external &&
        r.data.c4?.level !== "person",
    )
    .slice(0, 40)
    .map((r) => {
      const c = byComponent.get(r.id);
      return {
        id: r.id,
        title: clip(r.title, 80),
        ...(r.data.technology ? { technology: r.data.technology } : {}),
        ...(r.data.responsibility
          ? { does: clip(r.data.responsibility, 120) }
          : {}),
        ...(r.data.parent ? { in: r.data.parent } : {}),
        ...(r.data.contract?.allowedDependencies?.length
          ? { dependsOn: r.data.contract.allowedDependencies }
          : {}),
        code: c
          ? c.state === "no-files"
            ? "no planned files"
            : `${c.state}: ${c.present.length}/${c.planned.length} planned files exist`
          : "not scanned",
        ...(c?.unplannedUses.length
          ? {
              unplannedDependencies: [
                ...new Set(c.unplannedUses.map((u) => u.component)),
              ],
            }
          : {}),
      };
    });
  const build = buildPlan(doc);
  return {
    plan: { id: plan, title: current.title, revision: current.revision },
    records: counts,
    components,
    ...(components.length >= 40 ? { moreComponents: true } : {}),
    code: latest
      ? {
          scannedAt: latest.checkedAt,
          files: latest.files.length,
          ...(coverage
            ? {
                built: coverage.totals.built,
                partial: coverage.totals.partial,
                notStarted: coverage.totals.planned,
                filesOutsidePlan: coverage.unplannedCount,
              }
            : {}),
        }
      : { scannedAt: null, note: "No code scan yet." },
    build: {
      ready: build.ready,
      ...(build.problems.length ? { problems: build.problems.slice(0, 6) } : {}),
    },
  };
}

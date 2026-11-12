import { inventory } from "../../analysis/code-inventory.ts";
import { planCoverage } from "../../contracts/plan-coverage.ts";
import type { Document } from "../../domain/records.ts";
import type { PlanMap } from "./model.ts";

// The plan as a build's subagents read it: the records they build from, and
// how far the files in the project folder are from the planned ones.

const BUILT_KINDS = new Set(["component", "interface", "requirement", "scenario", "decision"]);

const UNPLANNED_SHOWN = 50;

export function planMap(doc: () => Document, folder: string): PlanMap {
  return {
    records(ids) {
      const plan = doc();
      if (ids?.length) {
        const wanted = new Set(ids);
        return {
          records: plan.records.filter((r) => wanted.has(r.id)),
          links: plan.links.filter((l) => wanted.has(l.from) || wanted.has(l.to)),
        };
      }
      const records = plan.records.filter((r) => r.status !== "superseded" && BUILT_KINDS.has(r.kind));
      const listed = new Set(records.map((r) => r.id));
      return {
        records: records.map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
        links: plan.links
          .filter((l) => listed.has(l.from) && listed.has(l.to))
          .map((l) => ({ kind: l.kind, from: l.from, to: l.to })),
      };
    },
    async coverage() {
      // Which planned files exist needs only the file list. The full source
      // analysis would also refuse to answer while subagents are writing.
      const source = inventory(folder);
      const coverage = planCoverage(doc(), {
        digest: source.digest,
        checkedAt: new Date().toISOString(),
        files: source.files.map((f) => ({ path: f.path, imports: [] })),
        omissions: source.omissions,
      });
      return {
        components: coverage.components.map((c) => ({
          id: c.id,
          state: c.state,
          ...(c.missing.length ? { missing: c.missing } : {}),
        })),
        totals: coverage.totals,
        filesOutsidePlan: coverage.unplanned.slice(0, UNPLANNED_SHOWN),
        // A file counted missing may only be unread: the reader must know.
        ...(source.incomplete.length ? { incomplete: source.incomplete } : {}),
      };
    },
  };
}

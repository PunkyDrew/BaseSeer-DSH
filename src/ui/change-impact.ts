import type { Document, Link, PlanningRecord } from "../domain/records.ts";
import { recordLinks } from "./graph-model.ts";

export type ImpactItem = { record: PlanningRecord; path: Link[] };

// Reverse dependency traversal gives review candidates, never a verdict that
// their code must change. Keep an actual shortest path, including its rationale.
export function changeImpact(doc: Document, selected: string) {
  const architecture = new Map(
    doc.records
      .filter((r) => ["component", "interface"].includes(r.kind))
      .map((r) => [r.id, r]),
  );
  const subject = architecture.get(selected);
  if (!subject) return null;
  const links = recordLinks(doc);
  const dependencies = links.filter(
    (l) =>
      ["uses", "implements", "depends-on"].includes(l.kind) &&
      architecture.has(l.from) &&
      architecture.has(l.to),
  );
  const paths = new Map<string, Link[]>([[selected, []]]);
  const queue = [selected];
  const items: ImpactItem[] = [];
  for (let index = 0; index < queue.length; index++) {
    const target = queue[index];
    for (const link of dependencies.filter((l) => l.to === target)) {
      if (paths.has(link.from)) continue;
      const path = [link, ...paths.get(target)!];
      paths.set(link.from, path);
      queue.push(link.from);
      items.push({ record: architecture.get(link.from)!, path });
    }
  }
  const requirements = doc.records.filter(
    (r) =>
      r.kind === "requirement" &&
      links.some(
        (l) => l.kind === "satisfies" && l.to === r.id && paths.has(l.from),
      ),
  );
  const subjects = new Set([...paths.keys(), ...requirements.map((r) => r.id)]);
  const evidence = doc.records.filter(
    (r) =>
      r.kind === "evidence" &&
      (r.data.inputs?.some((input: { record: string }) =>
        subjects.has(input.record),
      ) ||
        links.some(
          (l) =>
            ["supports", "contradicts"].includes(l.kind) &&
            ((l.from === r.id && subjects.has(l.to)) ||
              (l.to === r.id && subjects.has(l.from))),
        )),
  );
  return {
    subject,
    direct: items.filter((item) => item.path.length === 1),
    indirect: items.filter((item) => item.path.length > 1),
    requirements,
    evidence,
  };
}

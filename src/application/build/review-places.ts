import { builtComponents } from "../../domain/build-plan.ts";
import type { Document } from "../../domain/records.ts";
import type { ReviewPlace } from "./model.ts";

// The planner chooses which model builds each component, and a review's items
// are the evidence of where that choice fell short: each names the files it
// was seen in, and the plan names each component's files and model.

/** The review's items: its numbered paragraphs, or the whole report when it numbers none. */
export function reviewItems(report: string) {
  const numbered = report.split(/^(?=\s*\d+\.\s)/m).filter((part) => /^\s*\d+\.\s/.test(part));
  return numbered.length ? numbered : [report];
}

/** An item's first line without its number or emphasis: what it says in a sentence. */
export const headline = (item: string) =>
  item.trim().split("\n")[0].replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").trim();

/**
 * How many of the review's items fell in each component, most first: an
 * item counts once for every component whose planned files it names, and
 * once as outside the plan when it names none.
 */
export function reviewPlaces(report: string, doc: Document): ReviewPlace[] {
  const places: ReviewPlace[] = [];
  const owners = new Map<string, ReviewPlace[]>();
  for (const c of builtComponents(doc)) {
    if (!c.data.build) continue;
    const place = { component: { id: c.id, title: c.title, route: c.data.build }, items: 0 };
    places.push(place);
    for (const file of c.data.contract?.sourceTargets ?? []) owners.set(file, [...(owners.get(file) ?? []), place]);
  }
  const outside: ReviewPlace = { items: 0 };
  for (const item of reviewItems(report)) {
    const named = new Set((item.match(/[\w./-]+\.\w+/g) ?? []).flatMap((file) => owners.get(file) ?? []));
    for (const place of named.size ? named : [outside]) place.items++;
  }
  return [...places, outside].filter((place) => place.items).sort((a, b) => b.items - a.items);
}

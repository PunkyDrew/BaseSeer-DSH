import type { CodeFindings } from "../code-findings.ts";

const UNPLANNED_SHOWN = 16;
const DUPLICATES_SHOWN = 8;

const placeText = (place: { path: string; name: string }) =>
  `${place.name} in ${place.path}`;

/**
 * The imports between components that the plan's dependencies do not allow,
 * for a reader outside a build, where no check fails on them. Nothing when
 * there are none.
 */
export function unplannedImportsToLook(findings: CodeFindings) {
  if (!findings.unplannedImports.length) return [];
  return [
    `Imports between components that the plan's dependencies do not allow: ${findings.unplannedImports.slice(0, UNPLANNED_SHOWN).map((i) => `${i.path}${i.line ? `:${i.line}` : ""} (${i.description})`).join("; ")}. Remove each coupling (move what both need into the shared code, or call through the planned service), or allow it in the plan.`,
  ];
}

/**
 * What BaseSeer's source analysis found that does not fail the check: places
 * to look rather than failures, since two bodies alike can do different
 * jobs. Nothing when it found nothing.
 */
export function placesToLook(findings: CodeFindings) {
  if (!findings.duplicates.length) return [];
  return [
    `Function bodies written word for word in more than one place: ${findings.duplicates.slice(0, DUPLICATES_SHOWN).map((d) => `${d.places.map(placeText).join(" and ")} (${d.lines} lines)`).join("; ")}. Keep one and use it from both, where they do the same job.`,
  ];
}

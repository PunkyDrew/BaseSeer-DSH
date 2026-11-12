import type { Document } from "../../../domain/records.ts";
import { clip, type ChangeScope, type RecordChange } from "../model.ts";
import { recordText } from "./plan-text.ts";

// What a build of a project already built is told: what changed in the plan
// since the last build, with the earlier text of each changed or removed
// record where the plan's history holds it, since the code still does what
// that text said.

const EARLIER_TEXT = 1500;

function changeLine(change: RecordChange, before?: Document) {
  const line = `- ${change.change}: ${change.kind} "${change.title}" (${change.id})`;
  if (change.change === "added") return line;
  const earlier = before?.records.find((r) => r.id === change.id);
  return earlier ? `${line}; before, it read: ${clip(recordText(earlier), EARLIER_TEXT)}` : line;
}

/** A change build's account of what changed since the last build. */
export function changeSection(scope: ChangeScope, before?: Document) {
  const since = scope.since.endedAt.slice(0, 10);
  return `The project folder holds its code as the last build (${since}) left it. The owner's messages since that build started are marked new, and the plan changed since then:\n${scope.changes.map((c) => changeLine(c, before)).join("\n")}\nChange the code where the plan changed, rather than around it, and keep everything else working as it is. For a removed component, remove its files and the routes, navigation, sample content, tests and other code that refer to it. Change the tests that expect what the plan no longer asks, and add tests for what is new.`;
}

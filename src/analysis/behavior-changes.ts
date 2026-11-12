import { canonical, type Document } from "../domain/records.ts";

// Count-preserving multiset difference: a duplicated prior item must be
// retained as many times as it was recorded.
function missing(prior: any[], current: any[]) {
  const counts = new Map<string, number>();
  for (const item of current) {
    const key = canonical(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return prior.filter((item) => {
    const key = canonical(item),
      count = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1);
    return false;
  });
}

// Structural/text comparison only. Renaming a node or rewording a condition can
// preserve semantics; retaining every string can still hide a behavioral error.
export function behaviorChanges(before: Document, after: Document) {
  const next = new Map(after.records.map((r) => [r.id, r]));
  return before.records.flatMap((record) => {
    if (record.kind !== "scenario" || !record.data.flow) return [];
    const prior = record.data.flow;
    const current = next.get(record.id)?.data.flow;
    const nodes = new Set(current?.nodes.map((n: any) => n.id) ?? []);
    const missingNodes = prior.nodes.filter((n: any) => !nodes.has(n.id));
    const missingTransitions = missing(
      prior.transitions,
      current?.transitions ?? [],
    );
    // Messages are optional (schema 14). Report them only when present, so
    // receipts for flows without messages keep their exact shape.
    const missingMessages = missing(
      prior.messages ?? [],
      current?.messages ?? [],
    );
    const entryChanged = prior.entry !== current?.entry;
    if (
      !missingNodes.length &&
      !missingTransitions.length &&
      !missingMessages.length &&
      !entryChanged
    )
      return [];
    return [
      {
        scenario: record.id,
        title: record.title,
        previousVersion: record.version,
        currentVersion: next.get(record.id)?.version ?? null,
        entryChanged,
        previousEntry: prior.entry,
        currentEntry: current?.entry ?? null,
        priorNodesNotRetained: missingNodes.slice(0, 20),
        priorNodeCount: missingNodes.length,
        priorTransitionsNotRetained: missingTransitions.slice(0, 20),
        priorTransitionCount: missingTransitions.length,
        ...(prior.messages
          ? {
              priorMessagesNotRetained: missingMessages.slice(0, 20),
              priorMessageCount: missingMessages.length,
            }
          : {}),
      },
    ];
  });
}

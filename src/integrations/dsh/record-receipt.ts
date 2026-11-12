import { behaviorChanges } from "../../analysis/behavior-changes.ts";
import { buildReadiness } from "../../application/build-readiness.ts";
import type { Records } from "../../application/records.ts";
import type { Actor } from "../../application/planning.ts";

// Use the same boundary for every planner: capture the preimage before the
// synchronous atomic command. Reads retain saved data and add computed guidance.
export function executeRecordTool(
  records: Records,
  actor: Actor,
  command: any,
) {
  const readOnly = ["read", "schema"].includes(command?.op);
  // A preview runs the nested command for real and rolls it back, so it gets
  // the same receipt, marked as not saved.
  const inner = command?.op === "preview" ? command.command : command;
  const before = readOnly ? undefined : records.read(actor.plan);
  const result = records.execute(actor, command);
  // Idempotent replay may return an older committed result. Today's document
  // is not that command's preimage and must never be compared as though it is.
  const preimage = before?.revision === inner?.expected ? before : undefined;
  if (readOnly)
    return command.op === "read"
      ? {
          ...result,
          // A filtered read must not hide the build's readiness.
          build: buildReadiness(records.doc(actor.plan)),
        }
      : result;
  const receipt = recordWriteReceipt(inner, result, preimage);
  return command.op === "preview"
    ? {
        ...receipt,
        preview: true,
        nextRevision: result.nextRevision,
        undoAvailable: false,
      }
    : receipt;
}

// The model needs evidence of both record and relationship writes. Record-only
// history is not a signal that an atomic command silently dropped its links.
export function recordWriteReceipt(command: any, result: any, before?: any) {
  const supplied =
    command.op === "link" ? [command.link] : (command.links ?? []);
  const ids = new Set(supplied.map((link: any) => link.id));
  let previous = before?.document,
    current = result.document;
  let proposal: string | null = null;
  // A proposal leaves the live document untouched. Compare its saved overlay
  // against its own accepted baseline, never against an unrelated draft.
  if (before && command.op === "proposal") {
    const added = result.proposals.find(
      (p: any) => !before.proposals.some((old: any) => old.id === p.id),
    );
    const base =
      added && result.baselines.find((b: any) => b.id === added.base);
    if (base) {
      proposal = added.id;
      previous = base.document;
      current = {
        ...previous,
        records: previous.records
          .filter((r: any) => !added.changes.some((c: any) => c.id === r.id))
          .concat(added.changes),
      };
    }
  }
  const components = current.records.filter(
    (record: any) =>
      record.kind === "component" &&
      record.status !== "cancelled" &&
      record.data.state !== "cancelled",
  );
  const unclassified = components
    .filter((record: any) => !record.data.c4)
    .map((record: any) => ({ id: record.id, title: record.title }));
  // The owner opens a part to see the flows it acts in; a part that acts in
  // none can only show its links.
  const acting = new Set(
    current.records
      .filter((record: any) => record.kind === "scenario")
      .flatMap((record: any) => [...record.data.steps, ...(record.data.flow?.nodes ?? [])])
      .map((step: any) => step.component),
  );
  const flowless = components
    .filter(
      (record: any) =>
        record.data.c4?.level === "component" && !record.data.c4.external && !acting.has(record.id),
    )
    .map((record: any) => ({ id: record.id, title: record.title }));
  const unpeopled =
    components.length > 0 &&
    !components.some((record: any) => record.data.c4?.level === "person");
  return {
    revision: result.revision,
    // Advisory only; omit the note entirely when classification is complete.
    ...(unclassified.length
      ? {
          c4Classification: {
            components: unclassified,
            instruction:
              "Classify these components in your next write with data.c4.level and data.parent where contained; mark people and outside systems external:true. Record only intended design or cited source; classification is not verification.",
          },
        }
      : {}),
    ...(unpeopled
      ? {
          c4People:
            "No person is recorded. In your next write, record the people who use the system as components with data.c4:{level:\"person\",external:true}, and the outside systems it works with as {level:\"system\",external:true}, each linked with uses to what it uses, so the plan's pictures show who uses the system and what it depends on.",
        }
      : {}),
    ...(flowless.length
      ? {
          scenarioCoverage: {
            components: flowless,
            instruction:
              "These components take part in no scenario. Where one does work in an operation the owner described, name it in a step of that operation's scenario, or record a scenario for the operation, so its flow shows what it does. A component that only holds shared types or data needs none.",
          },
        }
      : {}),
    summary: result.summary,
    undoAvailable: result.undoAvailable,
    build: buildReadiness(current),
    behaviorReview: {
      assessment: "advisory-not-verification",
      comparisonAvailable: Boolean(previous),
      proposal,
      items: previous ? behaviorChanges(previous, current) : [],
      instruction:
        "Earlier nodes, transitions or messages may have been removed, renamed or reworded. Reconcile with the requested change; preserve unaffected paths and explain deliberate replacements. Up to 20 prior nodes, 20 transitions and 20 messages per scenario are shown, with full counts. History retains the prior document. No advisory is not proof of semantic preservation or complete behavior.",
    },
    changes: result.history[0]?.changes ?? [],
    relationships: {
      total: result.document.links.length,
      saved: result.document.links.filter((link: any) => ids.has(link.id)),
      removed: before
        ? before.document.links
            .filter((link: any) => !result.document.links.some((kept: any) => kept.id === link.id))
            .map((link: any) => link.id)
        : [],
    },
    versions: result.document.records.map((record: any) => ({
      id: record.id,
      version: record.version,
    })),
  };
}

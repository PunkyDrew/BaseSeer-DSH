import type { Document, PlanningRecord } from "../domain/records.ts";
import { friendlyTime } from "./friendly-time.ts";

export function codeCheckTime(
  record: PlanningRecord,
  document: Pick<Document, "records">,
): string | undefined {
  const snapshot =
    record.kind === "snapshot"
      ? record
      : document.records.find((r) => r.id === record.data.snapshot);
  return (
    snapshot?.title.match(
      /\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})/,
    )?.[0] ?? record.data.checkedAt
  );
}

/** Translate old saved checks without rewriting their source records. */
export function codeCheckCopy(
  record: PlanningRecord,
  document: Pick<Document, "records">,
) {
  const snapshot =
    record.kind === "snapshot"
      ? record
      : document.records.find((r) => r.id === record.data.snapshot);
  const count = snapshot?.data.files
    ? Object.keys(snapshot.data.files).length
    : Number(
        record.data.scope?.match(/^(\d+)\s+(?:readable\s+)?files?/)?.[1] ?? 0,
      );
  const date = codeCheckTime(record, document);
  return {
    title: `Code check${date ? ` · ${friendlyTime(date)}` : ""}`,
    result: count === 0 ? "No code yet" : `${count} files checked`,
    date: date ? friendlyTime(date) : "Date unavailable",
  };
}

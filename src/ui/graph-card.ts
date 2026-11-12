import type { Link, PlanningRecord } from "../domain/records.ts";

/** Display-only compression: the record and inspector retain all original prose. */
export function firstSentence(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? clean;
}

export function cardFiles(record?: PlanningRecord): string[] {
  if (!record) return [];
  const paths =
    record.data.contract?.sourceTargets ?? record.data.observed?.paths ?? [];
  return [...new Set<string>(paths)];
}

const extensions: Record<string, string> = {
  mjs: "JavaScript",
  js: "JavaScript",
  ts: "TypeScript",
  py: "Python",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  db: "SQLite file",
  sqlite: "SQLite file",
};

export function componentType(record?: PlanningRecord): string {
  const c4 = record?.data.c4;
  if (c4?.level === "person") return "Person";
  if (c4?.level === "system" && c4.external) return "External system";
  return (
    (
      {
        person: "Person",
        system: "System",
        container: "Container",
        component: "Component",
      } as Record<string, string>
    )[c4?.level] ?? "Component"
  );
}

/** A long format text shows as its first clause, cut to fit the card. */
export function cardFormat(format: string): string {
  const clause = format
    .trim()
    .split(/;|\.| under |\{/)[0]
    .trim();
  return clause.length > 40 ? `${clause.slice(0, 39).trimEnd()}…` : clause;
}

export function cardTechnology(record?: PlanningRecord): string {
  if (!record) return "";
  if (record.kind === "interface")
    return record.data.format ? cardFormat(record.data.format) : "";
  if (record.kind !== "component") return "";
  if (record.data.c4?.level === "person") return "";
  if (record.data.technology?.trim()) return record.data.technology.trim();
  if (record.data.c4?.external || record.data.c4?.level === "system") return "";
  // Only declared planned files can suggest technology; observed code is not a plan.
  const derived = [
    ...new Set<string>(
      (record.data.contract?.sourceTargets ?? [])
        .map((path: string) => extensions[path.split(".").pop()!.toLowerCase()])
        .filter(Boolean),
    ),
  ];
  return derived.length ? `${derived.join(", ")} (from planned files)` : "";
}

export function componentParent(
  record: PlanningRecord,
  records: PlanningRecord[] = [],
  links: Link[] = [],
): PlanningRecord | undefined {
  const id =
    record.data.parent ??
    links.find((link) => link.kind === "parent" && link.from === record.id)?.to;
  return records.find(
    (parent) => parent.id === id && parent.kind === "component",
  );
}

export function plainPlace(
  record?: PlanningRecord,
  records: PlanningRecord[] = [],
  links: Link[] = [],
): string {
  if (record?.kind === "interface") return "connection between parts";
  const c4 = record?.data.c4;
  if (c4?.level === "person") return "person using your app";
  if (c4?.external) return "outside your app (not built here)";
  if (c4?.level === "system") return "your whole app";
  const parent = record && componentParent(record, records, links);
  if (c4?.level === "container")
    return parent
      ? `runs on its own inside ${parent.title}`
      : "runs on its own";
  return parent ? `part of ${parent.title}` : "part of your app";
}

/** Remove empty introductions before the visible two-line clamp is applied. */
export function cardPurpose(text: string): string {
  return firstSentence(text).replace(
    /^(?:provides? (?:the |an? )?|responsible for |this (?:component|system|container) (?:provides? |is responsible for ))/i,
    "",
  );
}

export function fileSummary(paths: readonly string[]): string {
  return (
    paths.slice(0, 3).join(", ") +
    (paths.length > 3 ? ` +${paths.length - 3}` : "")
  );
}

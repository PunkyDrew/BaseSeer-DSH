import type {
  ReviewBindingView,
  SavedMap,
  StatementSupportView,
} from "../contracts/project-map.ts";
import type { PlanningRecord } from "../domain/records.ts";
import {
  materialStatements,
  type StatementSupport,
} from "../domain/statement-support.ts";
import {
  readProjectFile,
  configurationCurrent,
} from "../analysis/project-scan.ts";
import { analysisToolsCurrent } from "../analysis/language-runner.ts";
import { gitContext, gitContextAsync } from "../analysis/git-context.ts";

export async function mapSourceCurrentAsync(map: SavedMap, root: string) {
  const s = map.latest;
  if (!s) return false;
  try {
    return (
      analysisToolsCurrent(s.analysis) &&
      JSON.stringify(await gitContextAsync(root)) === JSON.stringify(s.git) &&
      configurationCurrent(root, s.analysis?.configuration ?? []) &&
      s.files.every((f) => readProjectFile(root, f.path).sha256 === f.sha256)
    );
  } catch {
    return false;
  }
}

export function mapSourceCurrent(map: SavedMap, root: string) {
  const s = map.latest;
  if (!s) return false;
  try {
    return (
      analysisToolsCurrent(s.analysis) &&
      configurationCurrent(root, s.analysis?.configuration ?? []) &&
      JSON.stringify(gitContext(root)) === JSON.stringify(s.git) &&
      s.files.every((f) => readProjectFile(root, f.path).sha256 === f.sha256)
    );
  } catch {
    return false;
  }
}

export function statementSupport(
  r: PlanningRecord,
  map: SavedMap,
  current = true,
): StatementSupportView {
  const ref = r.data.source;
  const explanation = map.explanations.find(
    (e) => e.id === ref?.explanation && e.context === ref?.context,
  );
  const s = map.latest;
  const historical =
    !current ||
    !s ||
    !explanation ||
    ref?.context !== s.context ||
    r.status === "superseded";
  const items = (r.data.support as StatementSupport | undefined)?.items ?? [];
  const statements = materialStatements(r).map((claim) => {
    const item = items.find((i) => i.target === claim.target);
    const citations = (item?.citations ?? [])
      .map((i) => explanation?.sources[i])
      .filter((c) => !!c);
    const valid =
      !!item?.citations.length &&
      citations.length === item.citations.length &&
      citations.every((c) => {
        const file = s?.files.find((f) => f.path === c.path);
        return (
          file &&
          file.sha256 === c.sha256 &&
          c.startLine >= 1 &&
          c.endLine <= file.lines
        );
      });
    const anchor = historical
      ? "historical"
      : valid
        ? "valid-location"
        : "missing";
    let binding:
      | "not-requested"
      | "matched-static"
      | "unresolved"
      | "contradicted" = "not-requested";
    let reason = item?.gap ?? "No statement-specific support recorded.";
    let analyzer: string | undefined;
    if (item?.relationship) {
      const rel = item.relationship;
      const analysis = s?.files.find((f) => f.path === rel.path)?.analysis;
      const candidates =
        analysis?.relationships.filter(
          (x) =>
            x.range.startLine === rel.line &&
            x.range.startColumn === rel.column,
        ) ?? [];
      const fact = candidates.length === 1 ? candidates[0] : undefined;
      analyzer =
        analysis &&
        `${analysis.adapter} ${analysis.adapterVersion} · ${analysis.tool} ${analysis.toolVersion}`;
      const covers = (path: string, start: number, end: number) =>
        citations.some(
          (c) => c.path === path && c.startLine <= start && c.endLine >= end,
        );
      if (
        anchor !== "valid-location" ||
        !fact ||
        fact.resolution !== "resolved" ||
        !fact.target
      ) {
        binding = "unresolved";
        reason = [
          reason,
          fact?.reason ??
            "A current unique resolved language fact is unavailable.",
        ]
          .filter(Boolean)
          .join(" ");
      } else if (
        fact.target.path !== rel.targetPath ||
        fact.target.symbol !== rel.targetSymbol
      ) {
        binding = "contradicted";
        reason =
          "The language analyzer binds this source site to a different declaration.";
      } else if (
        !covers(rel.path, fact.range.startLine, fact.range.endLine) ||
        !covers(
          fact.target.path,
          fact.target.range.startLine,
          fact.target.range.startLine,
        )
      ) {
        binding = "unresolved";
        reason =
          "Cite the relationship site and its target declaration in this statement's references.";
      } else binding = "matched-static";
    }
    return {
      ...claim,
      anchor,
      binding,
      interpretation: "unchecked" as const,
      interpretationGap:
        "Semantic support is unchecked: citation matching and static target binding do not establish this statement's meaning, branch condition, ordering or outcome.",
      execution: "not-established" as const,
      reason,
      analyzer,
      citations,
      gap:
        anchor !== "valid-location" ||
        !!item?.gap.trim() ||
        ["unresolved", "contradicted"].includes(binding),
    };
  });
  return {
    version: 1 as const,
    historical,
    digest: historical ? undefined : s?.digest,
    withoutSupport: !r.data.support,
    statements,
    missing: statements.filter((s) => s.gap).length,
    anchored: statements.filter((s) => s.anchor === "valid-location").length,
    staticBindings: statements.filter((s) => s.binding === "matched-static")
      .length,
  };
}

export function reviewBinding(
  r: PlanningRecord,
  records: PlanningRecord[],
  map: SavedMap,
  current = true,
): ReviewBindingView {
  const ref = r.data.source;
  const e = map.explanations.find(
    (x) => x.id === ref?.explanation && x.context === ref?.context,
  );
  const fresh =
    current &&
    !!e &&
    ref?.context === map.latest?.context &&
    r.status !== "superseded";
  const subjects: string[] =
    r.kind === "claim" ? [r.data.subject] : (r.data.subjects ?? []);
  const relevant =
    subjects.length > 0 &&
    subjects.every((id) => {
      const subject = records.find(
        (s) => s.id === id && s.status !== "superseded",
      );
      const source = subject?.data.source;
      const other = map.explanations.find(
        (x) => x.id === source?.explanation && x.context === source?.context,
      );
      return (
        source?.context === map.latest?.context &&
        !!other &&
        e?.sources.some((c) =>
          other.sources.some(
            (s) =>
              s.path === c.path &&
              s.sha256 === c.sha256 &&
              s.startLine <= c.endLine &&
              c.startLine <= s.endLine,
          ),
        )
      );
    });
  return {
    current: fresh && relevant,
    scope: map.latest?.scope ?? "",
    subjects,
    reason: !fresh
      ? "Historical, stale or unavailable source binding."
      : !relevant
        ? "No supporting subject with overlapping current source references."
        : "Current scope and source-linked subjects; interpretation remains unchecked.",
  };
}

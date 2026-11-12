import type {
  MapChanges,
  MapStatus,
  RecordSupport,
  SavedMap,
  ScenarioSource,
  SourceExplanation,
} from "../contracts/project-map.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/store.ts";
import { PlanError, object, text } from "../domain/plan.ts";
import {
  scanProject,
  scanScope,
  readProjectFile,
} from "../analysis/project-scan.ts";
import {
  type ProjectSnapshot,
  type ScanProgress,
} from "../contracts/project-map.ts";
import { gitContext } from "../analysis/git-context.ts";
import type { Document } from "../domain/records.ts";
import { componentMap } from "../contracts/component-map.ts";
import { planCoverage } from "../contracts/plan-coverage.ts";
import {
  mapSourceCurrent,
  mapSourceCurrentAsync,
  statementSupport,
  reviewBinding,
} from "./statement-support.ts";
import {
  connectionClaims,
  sourceConnections,
  connectionNeighborhood,
} from "../contracts/source-connections.ts";

export function mapOverview(snapshot: ProjectSnapshot) {
  const folders = new Map<
    string,
    {
      path: string;
      files: number;
      syntax: number;
      languages: Set<string>;
      examples: string[];
    }
  >();
  for (const file of snapshot.files) {
    const relative = snapshot.scope
      ? file.path.slice(snapshot.scope.length + 1)
      : file.path;
    const name = relative.includes("/")
      ? [snapshot.scope, relative.split("/")[0]].filter(Boolean).join("/")
      : snapshot.scope || ".";
    const group = folders.get(name) ?? {
      path: name,
      files: 0,
      syntax: 0,
      languages: new Set<string>(),
      examples: [],
    };
    ++group.files;
    if (file.coverage === "syntax") ++group.syntax;
    group.languages.add(file.language);
    if (group.examples.length < 4) group.examples.push(file.path);
    folders.set(name, group);
  }
  return {
    digest: snapshot.digest,
    context: snapshot.context,
    scope: snapshot.scope,
    checkedAt: snapshot.checkedAt,
    git: snapshot.git,
    files: snapshot.files.length,
    partial: snapshot.partial,
    exclusions: snapshot.omissions.length,
    localImports: snapshot.files.reduce(
      (n, f) => n + f.imports.filter((i) => i.resolution === "local").length,
      0,
    ),
    unresolvedImports: snapshot.files.reduce(
      (n, f) =>
        n + f.imports.filter((i) => i.resolution === "unresolved").length,
      0,
    ),
    folderCount: folders.size,
    folders: [...folders.values()].slice(0, 60).map((f) => ({
      ...f,
      languages: [...f.languages],
    })),
    limits: snapshot.limits,
    analysis: snapshot.analysis,
  };
}
export function mapChanges(
  baseline: ProjectSnapshot | null,
  latest: ProjectSnapshot,
): MapChanges {
  if (!baseline || baseline.scope !== latest.scope)
    return {
      comparable: false,
      reason: "The initial baseline uses a different scan folder.",
      added: [],
      changed: [],
      unavailable: [],
      contextChanged: false,
    };
  const before = new Map(baseline.files.map((f) => [f.path, f.sha256])),
    after = new Map(latest.files.map((f) => [f.path, f.sha256]));
  return {
    comparable: true,
    reason:
      "Unavailable means absent from this readable inventory; check exclusions before concluding deletion.",
    added: [...after.keys()].filter((p) => !before.has(p)),
    changed: [...after.keys()].filter(
      (p) => before.has(p) && before.get(p) !== after.get(p),
    ),
    unavailable: [...before.keys()].filter((p) => !after.has(p)),
    contextChanged:
      JSON.stringify(baseline.git) !== JSON.stringify(latest.git) ||
      baseline.analysis?.fingerprint !== latest.analysis?.fingerprint,
  };
}
type Job = {
  id: string;
  status: "running" | "complete" | "cancelled" | "error";
  progress?: ScanProgress;
  error?: string;
  abort: AbortController;
  /** Settles when the scan has saved, been cancelled or failed. Never rejects. */
  done?: Promise<void>;
};
export class ProjectMap {
  store: Store;
  jobs = new Map<string, Job>();
  constructor(store: Store) {
    this.store = store;
  }
  has(plan: string) {
    return this.store.maps.has(plan);
  }
  read(plan: string): SavedMap {
    const row = this.store.maps.read(plan);
    return row ? row : { baseline: null, latest: null, explanations: [] };
  }
  save(plan: string, data: SavedMap) {
    this.store.maps.save(plan, data);
  }
  enroll(plan: string) {
    if (!this.has(plan)) this.save(plan, this.read(plan));
  }
  scenarioSources(
    plan: string,
    document: { records: { id: string; kind: string; data: any }[] },
  ): Record<string, ScenarioSource> {
    const saved = this.read(plan);
    return Object.fromEntries(
      document.records
        .filter((r) => r.kind === "scenario" && r.data.source)
        .map((r) => {
          const ref = r.data.source;
          const explanation = saved.explanations.find(
            (e) => e.id === ref.explanation && e.context === ref.context,
          );
          const historical =
            !explanation || ref.context !== saved.latest?.context;
          return [
            r.id,
            {
              historical,
              digest: historical ? undefined : saved.latest?.digest,
              sources: explanation?.sources ?? [],
            },
          ];
        }),
    );
  }
  async recordSupportAsync(plan: string, document: Document, root: string) {
    const saved = this.read(plan);
    const current = await mapSourceCurrentAsync(saved, root);
    return this.recordSupport(plan, document, root, {
      saved,
      current:
        current && JSON.stringify(this.read(plan)) === JSON.stringify(saved),
    });
  }
  recordSupport(
    plan: string,
    document: Document,
    root: string,
    checked?: { saved: SavedMap; current: boolean },
  ): RecordSupport {
    const saved = checked?.saved ?? this.read(plan);
    const current = checked?.current ?? mapSourceCurrent(saved, root);
    return Object.fromEntries(
      document.records
        .filter((r) => r.data.source)
        .map((r) => [
          r.id,
          ["component", "scenario"].includes(r.kind)
            ? statementSupport(r, saved, current)
            : reviewBinding(r, document.records, saved, current),
        ]),
    );
  }
  status(plan: string): MapStatus {
    const job = this.jobs.get(plan),
      saved = this.read(plan);
    return {
      job: job && {
        id: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
      },
      snapshot: job?.status === "running" ? null : saved.latest,
      baseline: saved.baseline && {
        checkedAt: saved.baseline.checkedAt,
        scope: saved.baseline.scope,
        partial: saved.baseline.partial,
        files: saved.baseline.files.length,
      },
      changes: saved.latest ? mapChanges(saved.baseline, saved.latest) : null,
      explanations: saved.explanations.map((e) => ({
        ...e,
        stale: e.context !== saved.latest?.context,
      })),
    };
  }
  start(plan: string, root: string, scope: string) {
    scanScope(root, scope);
    this.store.project(plan);
    if (this.jobs.get(plan)?.status === "running")
      throw new PlanError(
        "BUSY",
        "A scan is already running for this project.",
      );
    const job: Job = {
      id: randomUUID(),
      status: "running",
      abort: new AbortController(),
    };
    this.jobs.set(plan, job);
    job.done = scanProject(root, scope, {
      signal: job.abort.signal,
      progress: (p) => {
        job.progress = p;
      },
    })
      .then((snapshot) => {
        if (job.abort.signal.aborted) {
          job.status = "cancelled";
          return;
        }
        const saved = this.read(plan);
        this.save(plan, {
          ...saved,
          baseline: saved.baseline ?? snapshot,
          latest: snapshot,
        });
        job.status = "complete";
      })
      .catch((error) => {
        job.status = job.abort.signal.aborted ? "cancelled" : "error";
        if (job.status === "error")
          job.error =
            error instanceof PlanError
              ? error.message
              : "Scan failed. Check folder access and try again.";
      });
    return { id: job.id, status: job.status };
  }
  cancel(plan: string, id: unknown) {
    const job = this.jobs.get(plan);
    if (!job || job.id !== id)
      throw new PlanError("STALE", "This scan is no longer active.");
    if (job.status === "running") job.abort.abort();
    return { cancelling: job.status === "running" };
  }
  async current(plan: string, root: string, digest: unknown) {
    const saved = this.read(plan).latest;
    if (!saved || saved.digest !== text(digest, "scan digest", 64))
      throw new PlanError(
        "STALE",
        "Scan again before using this source location.",
      );
    const now = await scanProject(root, saved.scope);
    return { saved, current: now.context === saved.context };
  }
  async source(plan: string, root: string, digest: unknown, name: unknown) {
    const { saved, current } = await this.current(plan, root, digest);
    if (!current)
      throw new PlanError(
        "STALE",
        "Source or Git context changed. Refresh code before opening it.",
      );
    const file = saved.files.find(
      (f) => f.path === text(name, "source path", 400),
    );
    if (!file)
      throw new PlanError(
        "DENIED",
        "This file is outside the inspected inventory.",
      );
    const value = readProjectFile(root, file.path);
    if (value.sha256 !== file.sha256)
      throw new PlanError(
        "STALE",
        "Source changed while opening it. Refresh code.",
      );
    return { path: file.path, ...value };
  }
  async explain(plan: string, root: string, input: unknown, author: string) {
    const q = object(input, [
      "digest",
      "title",
      "explanation",
      "sources",
      "connections",
    ]);
    const { saved, current } = await this.current(plan, root, q.digest);
    if (!current)
      throw new PlanError(
        "STALE",
        "Refresh the changed source before saving an explanation.",
      );
    if (
      !Array.isArray(q.sources) ||
      q.sources.length < 1 ||
      q.sources.length > 8
    )
      throw new PlanError(
        "INVALID",
        "An inference needs one to eight inspected source citations.",
      );
    const sources = q.sources.map((input) => {
      const ref = object(input, ["path", "startLine", "endLine", "quote"]),
        name = text(ref.path, "source path", 400),
        file = saved.files.find((f) => f.path === name);
      if (!file)
        throw new PlanError(
          "DENIED",
          "Citation is outside the scanned inventory.",
        );
      const startLine = Number(ref.startLine),
        endLine = Number(ref.endLine),
        quote = text(ref.quote, "source quote", 4000);
      if (!quote.trim())
        throw new PlanError(
          "INVALID",
          "A citation needs a nonempty source quote.",
        );
      if (
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine) ||
        startLine < 1 ||
        endLine < startLine ||
        endLine > file.lines ||
        endLine - startLine > 80
      )
        throw new PlanError(
          "INVALID",
          "Use an actual source range of up to 81 lines.",
        );
      const value = readProjectFile(root, name);
      if (
        value.sha256 !== file.sha256 ||
        !value.content
          .split(/\r?\n/)
          .slice(startLine - 1, endLine)
          .join("\n")
          .includes(quote)
      )
        throw new PlanError(
          "STALE",
          "Citation quote does not match the inspected source range.",
        );
      return { path: name, sha256: file.sha256, startLine, endLine, quote };
    });
    const entry: SourceExplanation = {
      id: randomUUID(),
      title: text(q.title, "title", 160),
      explanation: text(q.explanation, "explanation", 4000),
      kind: "inferred",
      context: saved.context,
      author,
      createdAt: new Date().toISOString(),
      sources,
      ...(q.connections === undefined
        ? {}
        : { connections: connectionClaims(q.connections, sources) }),
    };
    const state = this.read(plan);
    if (
      state.latest?.context !== saved.context ||
      JSON.stringify(gitContext(root)) !== JSON.stringify(saved.git)
    )
      throw new PlanError("STALE", "The scan context changed. Review again.");
    // Retain earlier inferences and their provenance; never rewrite accepted planning records.
    if (state.explanations.length >= 80)
      throw new PlanError(
        "LIMIT",
        "This map has 80 retained explanations. Continue with ordinary planning records.",
      );
    this.save(plan, { ...state, explanations: [...state.explanations, entry] });
    return entry;
  }
  async query(plan: string, root: string, input: unknown, author = "owner") {
    const q = object(input ?? { action: "overview" }, [
      "action",
      "scope",
      "id",
      "digest",
      "path",
      "explanation",
      "offset",
      "startLine",
      "endLine",
    ]);
    if (q.action === "start")
      return this.start(
        plan,
        root,
        q.scope === undefined ? "" : text(q.scope, "scan folder", 200),
      );
    if (q.action === "status") return this.status(plan);
    if (q.action === "cancel") return this.cancel(plan, q.id);
    if (q.action === "source") return this.source(plan, root, q.digest, q.path);
    if (q.action === "excerpt") {
      const source = await this.source(plan, root, q.digest, q.path);
      const lines = source.content.split(/\r?\n/);
      const start = q.startLine ?? 1;
      const end = q.endLine ?? Math.min(lines.length, Number(start) + 60);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        Number(start) < 1 ||
        Number(end) < Number(start) ||
        Number(end) > lines.length ||
        Number(end) - Number(start) > 80
      )
        throw new PlanError(
          "INVALID",
          "Choose an actual source range of up to 81 lines.",
        );
      return {
        path: source.path,
        sha256: source.sha256,
        startLine: start,
        endLine: end,
        lines: lines
          .slice(Number(start) - 1, Number(end))
          .map((text, index) => ({ line: Number(start) + index, text })),
      };
    }
    if (q.action === "freshness")
      return { current: (await this.current(plan, root, q.digest)).current };
    if (q.action === "explain")
      return this.explain(plan, root, q.explanation, author);
    const state = this.read(plan),
      latest = state.latest;
    if (!latest)
      throw new PlanError(
        "UNRESOLVED",
        "Use Scan code to establish the source baseline first.",
      );
    if (q.action === "inspect") return latest;
    if (q.action === "coverage")
      return planCoverage(this.store.documents.doc(plan), latest);
    if (q.action === "components") {
      const document = this.store.documents.doc(plan);
      return {
        ...componentMap(document, latest, state.explanations),
        sourceCurrent: await mapSourceCurrentAsync(state, root),
      };
    }
    if (q.action === "connections") {
      const all = sourceConnections(latest, state.explanations);
      const neighborhood = connectionNeighborhood(
        latest,
        all,
        q.path === undefined ? "" : text(q.path, "source path", 400),
      );
      return {
        ...neighborhood,
        files: neighborhood.files.map((f) => ({
          path: f.path,
          language: f.language,
          coverage: f.coverage,
        })),
        totalObserved: all.filter((c) => c.basis === "observed").length,
        totalInferred: all.filter((c) => c.basis === "inferred" && !c.stale)
          .length,
        instruction:
          "Directed source dependencies and inferred interactions. Inspect both ends to explain calls/data/interfaces. Unresolved imports and uncited interactions remain gaps; do not infer runtime correctness.",
      };
    }
    if (q.action === "files") {
      const offset = q.offset ?? 0,
        prefix =
          q.scope === undefined ? "" : text(q.scope, "folder prefix", 400);
      if (!Number.isSafeInteger(offset) || (offset as number) < 0)
        throw new PlanError(
          "INVALID",
          "File offset must be a nonnegative integer.",
        );
      const matches = latest.files.filter(
        (f) => !prefix || f.path.startsWith(prefix + "/"),
      );
      return {
        total: matches.length,
        offset,
        files: matches
          .slice(offset as number, (offset as number) + 100)
          .map((f) => ({
            path: f.path,
            language: f.language,
            coverage: f.coverage,
            lines: f.lines,
            declarations: f.declarations.length,
            imports: f.imports.length,
          })),
      };
    }
    if (q.action === "file") {
      const file = latest.files.find(
        (f) => f.path === text(q.path, "source path", 400),
      );
      return file ?? null;
    }
    if (q.action === "overview")
      return {
        ...mapOverview(latest),
        baseline: {
          checkedAt: state.baseline!.checkedAt,
          partial: state.baseline!.partial,
        },
        changes: mapChanges(state.baseline, latest),
        explanations: this.status(plan).explanations,
      };
    throw new PlanError("DENIED", "Unsupported project map operation.");
  }
}

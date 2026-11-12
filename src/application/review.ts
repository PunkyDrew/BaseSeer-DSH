import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Actor } from "./planning.ts";
import { Records } from "./records.ts";
import { inspectCode, inspectCodeAsync } from "../analysis/code.ts";
import type { RecordSupport } from "../contracts/project-map.ts";
import { inventory } from "../analysis/code-inventory.ts";
import { compareArchitecture } from "../analysis/architecture.ts";
import { PlanError } from "../domain/plan.ts";
import { canonical } from "../domain/records.ts";
import { observationDigest } from "../analysis/git-context.ts";
import { ProjectMap } from "./project-map.ts";

export class Review {
  records: Records;
  constructor(records: Records) {
    this.records = records;
  }
  async inspectAsync(actor: Actor, root: string) {
    const document = canonical(this.records.doc(actor.plan));
    const code = await inspectCodeAsync(root);
    const support = await new ProjectMap(this.records.store).recordSupportAsync(
      actor.plan,
      this.records.doc(actor.plan),
      root,
    );
    const binding = this.records.store.bindings.forWorkspace(actor.workspace);
    if (
      !binding ||
      binding.plan !== actor.plan ||
      binding.source !== actor.source ||
      binding.root !== fs.realpathSync(root)
    )
      throw new PlanError(
        "UNRESOLVED",
        "Workspace binding changed during source inspection",
      );
    if (canonical(this.records.doc(actor.plan)) !== document)
      throw new PlanError(
        "STALE",
        "Plan changed during source inspection; refresh review",
      );
    return this.inspect(actor, root, code, support);
  }
  async readAsync(actor: Actor, root: string) {
    const document = canonical(this.records.doc(actor.plan));
    const code = await inspectCodeAsync(root);
    const support = await new ProjectMap(this.records.store).recordSupportAsync(
      actor.plan,
      this.records.doc(actor.plan),
      root,
    );
    if (
      canonical(this.records.doc(actor.plan)) !== document ||
      inventory(root).digest !== (code.sourceDigest ?? code.digest)
    )
      throw new PlanError(
        "STALE",
        "Source changed during review; refresh code",
      );
    return this.read(actor, root, code, support);
  }
  inspect(
    actor: Actor,
    root: string,
    code = inspectCode(root),
    support?: RecordSupport,
  ) {
    const input = inventory(root);
    if (input.digest !== (code.sourceDigest ?? code.digest))
      throw new PlanError(
        "STALE",
        "Source changed during inspection; retry against a stable snapshot",
      );
    const observed = observationDigest(code);
    this.records.store.sources.observe(
      actor.plan,
      observed,
      input.files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        content: f.content,
      })),
    );
    const current = this.records.read(actor.plan),
      snapshotId = `source-${observed}`,
      analysisId = `analysis-${observed}`;
    if (!current.document.records.some((r: any) => r.id === snapshotId)) {
      const record = (id: string, kind: string, title: string, data: any) => ({
        id,
        kind,
        title,
        data,
        version: 1,
        status: "draft",
      });
      const rootId = `root-${actor.source}`;
      const files = Object.fromEntries(
        code.files.map((f) => [f.path, f.sha256]),
      );
      this.records.execute(
        { ...actor, id: "source-analysis", role: "owner" },
        {
          op: "batch",
          expected: current.revision,
          key: randomUUID(),
          reason:
            "Record actual source inspection and explicit analysis coverage",
          records: [
            ...(!current.document.records.some((r: any) => r.id === rootId)
              ? [
                  record(rootId, "sourceRoot", "Workspace source", {
                    repository: actor.source,
                    label: "Workspace source",
                  }),
                ]
              : []),
            record(
              snapshotId,
              "snapshot",
              `Source inspected ${code.checkedAt}`,
              {
                root: rootId,
                branch: code.git?.branch ?? "working files",
                commit:
                  code.git?.head ?? "not established by syntax inspection",
                tree: code.git?.tree ?? "content inventory",
                digest: observed,
                dirty: true,
                files,
                configuration: createHash("sha256")
                  .update(canonical(files))
                  .digest("hex"),
                sourceAvailability: "separate",
              },
            ),
            record(analysisId, "analysis", "Code check", {
              snapshot: snapshotId,
              tool: "BaseSeer language analysis",
              version: code.analyzer,
              capability:
                "Per-language declarations, scopes, project-local imports and static relationships; per-capability provenance and gaps remain in Code. Live boundary comparisons use current contracts separately.",
              outcome:
                code.partial || code.files.some((f) => f.coverage !== "syntax")
                  ? "partial"
                  : "completed",
              gaps: code.limits,
              scope: code.files.length
                ? `${code.files.length} files checked`
                : "No code yet",
            }),
          ],
          links: [],
        },
      );
    }
    return this.read(actor, root, code, support);
  }
  read(
    actor: Actor,
    root: string,
    code = inspectCode(root),
    support?: RecordSupport,
  ) {
    const current = this.records.read(actor.plan),
      doc = current.document;
    const architecture = compareArchitecture(doc, code);
    const designProvenance = architecture.modules.map((module) => ({
      record: module.id,
      acceptedBaseline:
        current.baselines.find(
          (b: any) =>
            b.id === current.baseline &&
            b.document.records.some(
              (r: any) =>
                r.id === module.id && r.version === module.design.version,
            ),
        )?.title ?? null,
      proposals: current.proposals
        .filter((p: any) => p.changes.some((r: any) => r.id === module.id))
        .map((p: any) => ({
          id: p.id,
          title: p.title,
          version: p.version,
          status: p.status,
        })),
    }));
    const recordSupport =
      support ??
      new ProjectMap(this.records.store).recordSupport(actor.plan, doc, root);
    const mappings = doc.records
      .filter((r: any) => r.kind === "mapping")
      .map((r: any) => {
        const snap = doc.records.find((s: any) => s.id === r.data.snapshot),
          file = code.files.find((f) => f.path === r.data.path);
        const saved = this.records.store.sources.contents(
          actor.plan,
          snap?.data.digest ?? "",
        );
        const historical =
          saved && saved.find((f: any) => f.path === r.data.path);
        const anchor = !historical
          ? "source unavailable for range verification"
          : r.data.endLine > historical.content.split("\n").length
            ? "invalid source range"
            : "range verified in saved source";
        return {
          ...r,
          anchor,
          freshness: !file
            ? "unavailable"
            : file.sha256 === snap?.data.files[r.data.path] &&
                (!code.git ||
                  (snap?.data.branch === code.git.branch &&
                    snap?.data.commit === code.git.head))
              ? "current"
              : "stale",
        };
      });
    const evidence = doc.records
      .filter((r: any) => ["evidence", "claim", "analysis"].includes(r.kind))
      .map((r: any) => {
        const snap = doc.records.find((s: any) => s.id === r.data.snapshot);
        const freshness = r.data.inputs?.some(
          (i: any) =>
            doc.records.find((x: any) => x.id === i.record)?.version !==
            i.version,
        )
          ? "stale criteria/design"
          : !snap
            ? "unknown"
            : snap.data.digest === observationDigest(code)
              ? "current"
              : "stale";
        const support = recordSupport[r.id];
        return {
          ...r,
          freshness: r.data.source
            ? support && "current" in support && support.current
              ? "current source; unchecked interpretation"
              : "historical or unrelated source"
            : freshness,
        };
      });
    return {
      revision: current.revision,
      code,
      snapshotId: `source-${observationDigest(code)}`,
      architecture,
      designProvenance,
      recordSupport,
      supportedRecords: doc.records
        .filter(
          (r: any) =>
            r.data.source && ["component", "scenario"].includes(r.kind),
        )
        .map((r: any) => ({
          id: r.id,
          title: r.title,
          ...recordSupport[r.id],
        })),
      mappings,
      evidence,
      snapshots: doc.records.filter((r: any) => r.kind === "snapshot"),
      findings: doc.records
        .filter((r: any) => r.kind === "finding")
        .map((r: any) => ({ ...r, binding: recordSupport[r.id] })),
    };
  }
  source(actor: Actor, digest: string, name: string) {
    const row = this.records.store.sources.contents(actor.plan, digest);
    const file = row && row.find((f: any) => f.path === name);
    if (!file)
      throw new PlanError(
        "UNAVAILABLE",
        "The inspected source snapshot is unavailable here. Current lines cannot substitute for this anchor.",
      );
    return { ...file, digest, historical: true };
  }
}

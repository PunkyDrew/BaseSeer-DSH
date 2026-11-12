import { isOperationCandidate } from "../analysis/operation-candidates.ts";
import { randomUUID } from "node:crypto";
import { Store } from "../storage/store.ts";
import {
  document,
  record,
  link,
  id,
  canonical,
  list,
  recordGuide,
  type Document,
  type PlanningRecord,
} from "../domain/records.ts";
import { at, object, PlanError, revision, text } from "../domain/plan.ts";
import type { Actor } from "./planning.ts";
import { mapSourceCurrent, statementSupport } from "./statement-support.ts";

const commandFields = [
  "op",
  "expected",
  "key",
  "record",
  "records",
  "links",
  "removes",
  "id",
  "link",
  "title",
  "reason",
  "base",
  "changes",
  "branch",
  "proposal",
  "ids",
  "command",
];

/** Why a planner cannot change or remove a decision the owner accepted, and what it can do instead. */
const acceptedDecision = (decision: PlanningRecord) =>
  `The owner accepted the decision "${decision.title}" (the owner's go for a build accepts the decisions it is built from), so only the owner changes it. To propose a change, add a draft decision with data.supersedes "${decision.id}" and name it to the owner: their go for the next build accepts it in place of "${decision.title}". Until then, plan within it.`;

export class Records {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  doc(plan: string): Document {
    return this.store.documents.doc(plan);
  }
  save(plan: string, input: Document) {
    this.store.documents.save(plan, input);
  }
  read(plan: string) {
    const p = this.store.read(plan),
      state = this.store.design.state(plan);
    return JSON.parse(
      canonical({
        ...p,
        document: this.doc(plan),
        baseline: state.baseline,
        baselines: this.store.design.baselines(plan),
        proposals: this.store.design.proposals(plan),
        history: this.store.recordsHistory.summaries(plan),
      }),
    );
  }
  owner(actor: Actor) {
    if (actor.role !== "owner")
      throw new PlanError(
        "DENIED",
        "This operation requires the project owner",
      );
  }
  validateScenarioSource(plan: string, r: PlanningRecord) {
    if (
      ["scenario", "component", "finding", "claim"].includes(r.kind) &&
      r.data.source
    ) {
      const map = this.store.maps.read(plan) ?? null;
      const citation = map?.explanations.find(
        (e: any) => e.id === r.data.source.explanation,
      );
      if (
        !map ||
        !citation ||
        citation.context !== r.data.source.context ||
        citation.context !== map.latest?.context
      )
        throw new PlanError(
          "STALE",
          "Source-inferred records need a current saved Code explanation. Inspect and cite the source before saving this record.",
        );
      const operation = r.data.source.operation;
      if (r.data.support || r.data.observed || r.data.coverage) {
        const binding = this.store.bindings.forPlan(plan);
        if (!binding || !mapSourceCurrent(map, binding.root))
          throw new PlanError(
            "STALE",
            "Source, branch, tool or configuration changed. Refresh Code before binding statements.",
          );
        for (const item of r.data.support?.items ?? [])
          if (item.citations.some((i: number) => !citation.sources[i]))
            throw new PlanError(
              "INVALID",
              "Statement citations must index this record's own explanation.",
            );
        for (const path of r.data.observed?.paths ?? [])
          if (!citation.sources.some((c: any) => c.path === path))
            throw new PlanError(
              "INVALID",
              "Observed component paths need citations in their own explanation.",
            );
        const support = statementSupport(r, map);
        if (support.statements.some((s) => s.binding === "contradicted"))
          throw new PlanError(
            "INVALID",
            "Statement target contradicts the resolved static language relationship. Inspect the source and correct the claim.",
          );
      }
      if (operation) {
        const file = map.latest.files.find(
          (f: any) => f.path === operation.path,
        );
        if (
          !file ||
          file.coverage !== "syntax" ||
          !file.declarations.some(
            (d: any) =>
              d.line === operation.line && isOperationCandidate(file, d),
          ) ||
          !citation.sources.some(
            (c: any) =>
              c.path === operation.path &&
              c.sha256 === file.sha256 &&
              c.startLine <= operation.line &&
              c.endLine >= operation.line,
          )
        )
          throw new PlanError(
            "INVALID",
            "Operation binding needs a known source declaration covered by its explanation citation.",
          );
      }
    }
  }
  // Exactly what an edit would do, by executing it in a transaction that is
  // always rolled back: no revision, history, command or record change remains.
  preview(actor: Actor, input: unknown): any {
    const inner = object(input, commandFields);
    if (["preview", "read", "schema"].includes(inner.op as string))
      throw new PlanError(
        "INVALID",
        "Preview a change: put, batch, remove, link, undo, baseline, proposal, accept-proposal or reject-proposal",
      );
    const result: any = this.store.rehearse(() =>
      this.run(actor, { ...inner, key: `preview-${randomUUID()}` }),
    );
    return {
      ...result,
      preview: true,
      revision: result.revision - 1,
      nextRevision: result.revision,
      undoAvailable: false,
      summary: `Preview only; nothing was saved. ${result.summary}`,
    };
  }
  execute(actor: Actor, input: unknown) {
    return this.run(actor, input);
  }
  // Stable high-level identity is checked by Store.command before preparing a
  // derived batch. Preparation remains synchronous inside the same transaction;
  // retries return the original receipt without rebuilding from newer records.
  executePreparedBatch(
    actor: Actor,
    identity: { expected: unknown; key: unknown; [key: string]: unknown },
    prepare: () => unknown,
  ) {
    return this.run(
      actor,
      { op: "batch", expected: identity.expected, key: identity.key },
      { identity, buildBatch: prepare },
    );
  }
  private run(
    actor: Actor,
    input: unknown,
    prepared?: { identity: unknown; buildBatch: () => unknown },
  ): any {
    let q = object(input, commandFields);
    const op = text(q.op, "operation", 40);
    if (op === "preview") return this.preview(actor, q.command);
    if (q.command !== undefined)
      throw new PlanError("INVALID", "Only a preview carries a nested command");
    if (op === "schema")
      return {
        ...recordGuide(),
        revision: this.store.read(actor.plan).revision,
      };
    if (op === "read") {
      const result = this.read(actor.plan);
      if (q.ids === undefined) return result;
      const selected = new Set(list(q.ids).map(id));
      return {
        ...this.store.read(actor.plan),
        baseline: result.baseline,
        document: {
          records: result.document.records.filter((r: any) =>
            selected.has(r.id),
          ),
          links: result.document.links.filter(
            (l: any) => selected.has(l.from) || selected.has(l.to),
          ),
        },
        coverage:
          "Selected records only; linked endpoints outside the selection can be queried by ID",
      };
    }
    if (!["owner", "planner"].includes(actor.role))
      throw new PlanError("DENIED", "Role cannot change planning records");
    const expected = revision(q.expected),
      key = text(q.key, "command identity", 100);
    return this.store.command(
      actor.id,
      key,
      {
        plan: actor.plan,
        ...(prepared ? { preparedBatch: prepared.identity } : q),
      },
      () => {
        if (prepared) {
          q = object(prepared.buildBatch(), commandFields);
          if (q.op !== "batch" || q.expected !== expected || q.key !== key)
            throw new PlanError(
              "INVALID",
              "Prepared batch changed its operation or command identity",
            );
        }
        const before = this.doc(actor.plan),
          current = this.store.read(actor.plan);
        if (current.revision !== expected)
          throw new PlanError(
            "CONFLICT",
            `Plan changed from revision ${expected} to ${current.revision}. Your edit was not applied.`,
            { expected, current: this.read(actor.plan) },
          );
        let after = structuredClone(before),
          reason = text(q.reason ?? op, "reason", 1000),
          reversible = false;
        if (["put", "batch", "remove", "link"].includes(op)) {
          reversible = true;
          const incoming =
            op === "put"
              ? [q.record]
              : op === "batch"
                ? at("batch.records", () =>
                    list(q.records === undefined ? [] : q.records),
                  )
                : [];
          // A batch is refused with every record's faults, so the writer fixes them all at once.
          const problems: string[] = [];
          const parsed = incoming.flatMap((raw) => {
            try {
              return [record(raw)];
            } catch (error) {
              if (!(error instanceof PlanError)) throw error;
              problems.push(error.message);
              return [];
            }
          });
          if (problems.length) throw new PlanError("INVALID", problems.join("\n"));
          for (const r of parsed) {
            const prior = after.records.find((x) => x.id === r.id);
            this.validateScenarioSource(actor.plan, r);
            if (
              actor.role === "planner" &&
              (["snapshot", "sourceRoot"].includes(r.kind) ||
                (r.kind === "analysis" &&
                  !["not-run", "unsupported"].includes(r.data.outcome)) ||
                (r.kind === "evidence" && r.data.assessment !== "unchecked") ||
                (r.kind === "claim" &&
                  (r.data.assessment !== "unchecked" ||
                    !["human-assertion", "agent-inference"].includes(
                      r.data.origin,
                    ))))
            )
              throw new PlanError(
                "DENIED",
                "Model-authored records cannot claim trusted extraction or executed verification. Use the inspection/verification adapters and link their evidence",
              );
            if (
              actor.role !== "owner" &&
              (r.status !== "draft" || prior?.status === "accepted")
            )
              throw new PlanError(
                "DENIED",
                prior?.status === "accepted" && prior.kind === "decision"
                  ? acceptedDecision(prior)
                  : "Planner edits must remain drafts; accepted records require owner review",
              );
            if (
              actor.role !== "owner" &&
              r.kind === "artifact" &&
              r.data.reviewed
            )
              throw new PlanError(
                "DENIED",
                "Artifact inclusion review is an owner action",
              );
            if (r.status === "accepted" || prior?.status === "accepted")
              this.owner(actor);
            r.version = (prior?.version ?? 0) + 1;
            after.records = after.records
              .filter((x) => x.id !== r.id)
              .concat(r);
          }
          // A batch removes what its records settle, such as the questions an
          // answer closes, in the same write.
          const removals =
            op === "remove"
              ? [id(q.id)]
              : op === "batch"
                ? at("batch.removes", () => list(q.removes ?? []).map(id))
                : [];
          for (const target of removals) {
            const prior = after.records.find((r) => r.id === target);
            if (!prior && !after.links.some((l) => l.id === target))
              throw new PlanError("INVALID", `${target} is neither a record nor a link in the plan`);
            if (
              actor.role !== "owner" &&
              prior?.status === "accepted" &&
              prior.kind === "decision"
            )
              throw new PlanError("DENIED", acceptedDecision(prior));
            if (prior?.status === "accepted") this.owner(actor);
            after.records = after.records.filter((r) => r.id !== target);
            // A link goes with either of its ends.
            after.links = after.links.filter(
              (l) => l.id !== target && l.from !== target && l.to !== target,
            );
          }
          for (const raw of op === "link"
            ? [q.link]
            : op === "batch"
              ? at("batch.links", () => list(q.links ?? []))
              : []) {
            const l = link(raw);
            after.links = after.links.filter((x) => x.id !== l.id).concat(l);
          }
          after = document(after);
          this.store.documents.save(actor.plan, after);
        } else if (op === "undo") {
          const row = this.store.recordsHistory.latest(actor.plan);
          if (
            !row ||
            row.revision !== expected ||
            !row.reason.startsWith("draft:")
          )
            throw new PlanError(
              "NOTHING_TO_UNDO",
              "The latest revision is not a reversible record edit",
            );
          const previous = document(row.before);
          if (
            before.records.some((r) => r.status === "accepted") ||
            previous.records.some((r) => r.status === "accepted")
          )
            this.owner(actor);
          after = document({
            ...previous,
            records: previous.records.map((r) => ({
              ...r,
              version:
                Math.max(
                  r.version,
                  before.records.find((n) => n.id === r.id)?.version ?? 0,
                ) + 1,
            })),
          });
          this.store.documents.save(actor.plan, after);
          reversible = true;
        } else if (op === "baseline") {
          this.owner(actor);
          const baseline = {
            id: randomUUID(),
            title: text(q.title, "baseline title", 200),
            revision: expected + 1,
            document: before,
            acceptedBy: actor.id,
          };
          this.store.design.addBaseline(actor.plan, baseline);
          this.store.design.selectBaseline(baseline.id, actor.plan);
        } else if (op === "proposal") {
          const base = id(q.base),
            row = this.store.design.baseline(actor.plan, base);
          if (!row)
            throw new PlanError(
              "UNRESOLVED",
              "Proposal needs an existing accepted baseline",
            );
          const changes = list(q.changes).map(record),
            baseDoc = row.document as Document;
          for (const r of changes) this.validateScenarioSource(actor.plan, r);
          document({
            ...baseDoc,
            records: baseDoc.records
              .filter((r) => !changes.some((c) => c.id === r.id))
              .concat(changes),
          });
          const p = {
            id: randomUUID(),
            base,
            title: text(q.title, "proposal title", 200),
            rationale: reason,
            branch: text(q.branch ?? "", "branch", 200),
            version: 1,
            status: "draft",
            changes,
          };
          this.store.design.addProposal(actor.plan, p);
        } else if (op === "accept-proposal" || op === "reject-proposal") {
          this.owner(actor);
          const row = this.store.design.proposal(actor.plan, id(q.proposal));
          if (!row) throw new PlanError("UNRESOLVED", "Unknown proposal");
          const p = row,
            state = this.store.design.state(actor.plan);
          if (p.status !== "draft")
            throw new PlanError(
              "STALE",
              "Proposal already has an owner decision",
            );
          if (op === "accept-proposal") {
            if (p.base !== state.baseline)
              throw new PlanError(
                "STALE",
                "The accepted baseline changed; compare and create a reconciled proposal",
              );
            const base = this.store.design.baseline(actor.plan, p.base)!;
            for (const c of p.changes)
              if (
                canonical(before.records.find((r) => r.id === c.id) ?? null) !==
                canonical(
                  base.document.records.find((r: any) => r.id === c.id) ?? null,
                )
              )
                throw new PlanError(
                  "CONFLICT",
                  "A proposed record also has unreviewed draft edits",
                );
            after = document({
              ...before,
              records: before.records
                .filter((r) => !p.changes.some((c: any) => c.id === r.id))
                .concat(
                  p.changes.map((c: any) => ({
                    ...c,
                    version:
                      (before.records.find((r) => r.id === c.id)?.version ??
                        0) + 1,
                  })),
                ),
            });
            this.store.documents.save(actor.plan, after);
            const b = {
              id: randomUUID(),
              title: p.title,
              revision: expected + 1,
              document: after,
              acceptedBy: actor.id,
              proposal: p.id,
            };
            this.store.design.addBaseline(actor.plan, b);
            this.store.design.selectBaseline(b.id, actor.plan);
          }
          p.status = op === "accept-proposal" ? "accepted" : "rejected";
          p.reason = reason;
          p.version++;
          this.store.design.saveProposal(actor.plan, p);
        } else
          throw new PlanError("DENIED", "Unknown structured planning command");
        this.store.advance(actor.plan, expected);
        const summary = `${reversible ? "draft:" : "decision:"}${reason}`;
        this.store.recordsHistory.append(
          actor.plan,
          expected + 1,
          actor.id,
          summary,
          before,
          after,
          new Date().toISOString(),
        );
        return {
          ...this.read(actor.plan),
          summary: `${reason} · revision ${expected} → ${expected + 1}`,
          undoAvailable: reversible,
        };
      },
    );
  }
}

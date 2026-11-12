import { canonical, document, type Document } from "../domain/records.ts";
import { PlanError } from "../domain/plan.ts";
import {
  historyBefore,
  sameDocument,
  type Baseline,
  type PlanFile,
  type Proposal,
} from "./plan-file.ts";

/**
 * How the plan's parts reach a plan: `view` is the plan as it stands, with
 * the changes of the transaction in progress; `edit` is the copy that
 * transaction changes, which the commit writes to the plan file. Parts
 * replace what they change (a new array, a new document) and never alter
 * the plan in place, so a transaction that fails leaves nothing behind.
 */
export interface PlanAccess {
  view(plan: string): PlanFile;
  edit(plan: string): PlanFile;
}

export type RecordHistory = {
  revision: number;
  actor: string;
  reason: string;
  before: Document;
  after: Document;
  time: string;
};
export type HistorySummary = Pick<RecordHistory, "revision" | "actor" | "reason" | "time"> & {
  changes: { id: string; title: string; action: string }[];
};

/** The plan's records and links. */
export class PlanDocuments {
  private readonly access: PlanAccess;
  constructor(access: PlanAccess) {
    this.access = access;
  }
  doc(plan: string): Document {
    return structuredClone(this.access.view(plan).document);
  }
  save(plan: string, input: Document) {
    const next = document(input);
    const state = this.access.edit(plan);
    const kinds = new Map(state.document.records.map((r) => [r.id, r.kind]));
    for (const r of next.records) {
      const prior = kinds.get(r.id);
      if (prior && prior !== r.kind)
        throw new PlanError("INVALID", "A record's kind cannot change");
    }
    state.document = next;
  }
}

/** The accepted design: baselines, the proposals against them, and which baseline stands. */
export class PlanDesign {
  private readonly access: PlanAccess;
  constructor(access: PlanAccess) {
    this.access = access;
  }
  state(plan: string): { baseline: string | null } {
    return { baseline: this.access.view(plan).baseline };
  }
  baselines(plan: string): Baseline[] {
    return structuredClone(this.access.view(plan).baselines);
  }
  proposals(plan: string): Proposal[] {
    return structuredClone(this.access.view(plan).proposals);
  }
  baseline(plan: string, id: string): Baseline | undefined {
    const found = this.access.view(plan).baselines.find((b) => b.id === id);
    return found && structuredClone(found);
  }
  proposal(plan: string, id: string): Proposal | undefined {
    const found = this.access.view(plan).proposals.find((p) => p.id === id);
    return found && structuredClone(found);
  }
  addBaseline(plan: string, value: Baseline) {
    const state = this.access.edit(plan);
    if (state.baselines.some((b) => b.id === value.id))
      throw new PlanError("INVALID", "Duplicate baseline");
    state.baselines = [...state.baselines, structuredClone(value)];
  }
  selectBaseline(id: string, plan: string) {
    this.access.edit(plan).baseline = id;
  }
  addProposal(plan: string, value: Proposal) {
    const state = this.access.edit(plan);
    if (state.proposals.some((p) => p.id === value.id))
      throw new PlanError("INVALID", "Duplicate proposal");
    state.proposals = [...state.proposals, structuredClone(value)];
  }
  saveProposal(plan: string, value: Proposal) {
    const state = this.access.edit(plan);
    if (!state.proposals.some((p) => p.id === value.id))
      throw new PlanError("UNRESOLVED", "Unknown proposal");
    state.proposals = state.proposals.map((p) =>
      p.id === value.id ? structuredClone(value) : p,
    );
  }
}

/** Every edit of the plan, in order, with the plan before and after it. */
export class PlanHistory {
  private readonly access: PlanAccess;
  constructor(access: PlanAccess) {
    this.access = access;
  }
  records(plan: string, descending = false): RecordHistory[] {
    const history = this.access.view(plan).history;
    const rows = history.map((h, index) => ({
      revision: h.revision,
      actor: h.actor,
      reason: h.reason,
      time: h.time,
      before: historyBefore(history, index),
      after: h.after,
    }));
    return structuredClone(descending ? rows.reverse() : rows);
  }
  latest(plan: string): RecordHistory | undefined {
    return this.records(plan, true)[0];
  }
  /**
   * The plan as it stood at a revision: the result of the edit that made it,
   * or what the next edit started from. Nothing when the history holds
   * neither.
   */
  planAt(plan: string, revision: number): Document | undefined {
    const history = this.access.view(plan).history;
    const made = history.findIndex((h) => h.revision === revision);
    if (made >= 0) return structuredClone(history[made].after);
    const next = history.findIndex((h) => h.revision === revision + 1);
    return next >= 0 ? structuredClone(historyBefore(history, next)) : undefined;
  }
  summaries(plan: string): HistorySummary[] {
    return this.records(plan, true).map((row) => {
      const previous = new Map(row.before.records.map((r) => [r.id, r]));
      const present = new Set(row.after.records.map((r) => r.id));
      const changes = row.after.records
        .filter((r) => canonical(previous.get(r.id) ?? null) !== canonical(r))
        .map((r) => ({
          id: r.id,
          title: r.title,
          action: previous.has(r.id) ? "updated" : "added",
        }));
      changes.push(
        ...row.before.records
          .filter((r) => !present.has(r.id))
          .map((r) => ({ id: r.id, title: r.title, action: "removed" })),
      );
      return {
        revision: row.revision,
        actor: row.actor,
        reason: row.reason,
        time: row.time,
        changes,
      };
    });
  }
  append(
    plan: string,
    revision: number,
    actor: string,
    reason: string,
    before: Document,
    after: Document,
    time: string,
  ) {
    const state = this.access.edit(plan);
    const last = state.history[state.history.length - 1];
    if (last && revision <= last.revision)
      throw new PlanError("INVALID", "History revisions are inconsistent");
    const previous = last?.after ?? { records: [], links: [] };
    const beforeDoc = document(before);
    state.history = [
      ...state.history,
      {
        revision,
        actor,
        reason,
        time,
        after: document(after),
        ...(sameDocument(beforeDoc, previous) ? {} : { before: beforeDoc }),
      },
    ];
  }
}

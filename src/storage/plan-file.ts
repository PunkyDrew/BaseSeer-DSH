import fs from "node:fs";
import {
  canonical,
  choice,
  document,
  id,
  list,
  record,
  type Document,
  type PlanningRecord,
} from "../domain/records.ts";
import { object, PlanError, revision, text, type OwnerMessage } from "../domain/plan.ts";
import {
  validateProjectMap,
  type SourceExplanation,
} from "../contracts/project-map.ts";
import { json, stored } from "./json.ts";
import { writeFileAtomically } from "./project-folder.ts";

// The plan file: everything the planner and the owner decided about a project,
// with the history of how it got there. BaseSeer is pre-production, so a file
// in another format is refused rather than migrated.
export const PLAN_FORMAT = "baseseer-plan";
export const PLAN_FORMAT_VERSION = 5;

/** One edit of the plan and its result; `before` is given only where it is not the previous entry's result. */
export type HistoryEntry = {
  revision: number;
  actor: string;
  reason: string;
  time: string;
  after: Document;
  before?: Document;
};
export type Baseline = {
  id: string;
  title: string;
  revision: number;
  document: Document;
  acceptedBy: string;
  proposal?: string;
};
export type Proposal = {
  id: string;
  base: string;
  title: string;
  rationale: string;
  branch: string;
  version: number;
  status: string;
  changes: PlanningRecord[];
  reason?: string;
};
export type PlanFile = {
  format: typeof PLAN_FORMAT;
  version: typeof PLAN_FORMAT_VERSION;
  id: string;
  title: string;
  revision: number;
  /** The identity of this project's source, as its snapshots and source roots name it. */
  source: string;
  /** The accepted baseline, when the design has one. */
  baseline: string | null;
  document: Document;
  history: HistoryEntry[];
  baselines: Baseline[];
  proposals: Proposal[];
  /** What the planner inferred about the code, with its citations; records with a source cite these. */
  explanations: SourceExplanation[];
  /** What the owner wrote in the project's Planning chats, oldest first: a build builds what these ask. */
  ownerMessages: OwnerMessage[];
};

export const EMPTY_DOCUMENT: Document = { records: [], links: [] };

/** Far beyond any message a person types or pastes into a chat; only a damaged file reaches it. */
const OWNER_MESSAGE_LIMIT = 1_000_000;

export function newPlanFile(planId: string, title: string, source: string): PlanFile {
  return {
    format: PLAN_FORMAT,
    version: PLAN_FORMAT_VERSION,
    id: planId,
    title,
    revision: 0,
    source,
    baseline: null,
    document: EMPTY_DOCUMENT,
    history: [],
    baselines: [],
    proposals: [],
    explanations: [],
    ownerMessages: [],
  };
}

function baseline(input: unknown, planRevision: number): Baseline {
  const b = object(input, ["id", "title", "revision", "document", "acceptedBy", "proposal"]);
  id(b.id);
  text(b.title, "baseline", 200);
  if (revision(b.revision) > planRevision)
    throw new PlanError("INVALID", "Future baseline");
  text(b.acceptedBy, "actor", 200);
  if (b.proposal !== undefined) id(b.proposal);
  return { ...b, document: document(b.document) } as Baseline;
}

function proposal(input: unknown, baselines: Baseline[]): Proposal {
  const p = object(input, [
    "id",
    "base",
    "title",
    "rationale",
    "branch",
    "version",
    "status",
    "changes",
    "reason",
  ]);
  id(p.id);
  const base = baselines.find((b) => b.id === id(p.base));
  if (!base) throw new PlanError("INVALID", "Missing proposal base");
  text(p.title, "proposal title", 200);
  text(p.rationale, "proposal rationale", 1000);
  text(p.branch, "branch", 200);
  revision(p.version);
  choice(p.status, ["draft", "accepted", "rejected", "superseded"]);
  if (p.reason !== undefined) text(p.reason, "decision reason", 1000);
  const changes = list(p.changes).map(record);
  // A proposal's changes must still make a valid plan on top of their base.
  document({
    ...base.document,
    records: base.document.records
      .filter((r) => !changes.some((c) => c.id === r.id))
      .concat(changes),
  });
  return { ...p, changes } as Proposal;
}

function ownerMessage(input: unknown): OwnerMessage {
  const m = object(input, ["time", "text", "replyTo"]);
  return {
    time: text(m.time, "message time", 100),
    text: text(m.text, "owner message", OWNER_MESSAGE_LIMIT),
    ...(m.replyTo === undefined ? {} : { replyTo: text(m.replyTo, "planner message", OWNER_MESSAGE_LIMIT) }),
  };
}

function historyEntry(input: unknown, previous: number, planRevision: number): HistoryEntry {
  const h = object(input, ["revision", "actor", "reason", "time", "after", "before"]);
  const n = revision(h.revision);
  if (n <= previous || n > planRevision)
    throw new PlanError("INVALID", "History revisions are inconsistent");
  text(h.actor, "actor", 200);
  text(h.reason, "reason", 2000);
  text(h.time, "time", 100);
  return {
    revision: n,
    actor: h.actor as string,
    reason: h.reason as string,
    time: h.time as string,
    after: document(h.after),
    ...(h.before !== undefined ? { before: document(h.before) } : {}),
  };
}

export function validatePlanFile(input: unknown): PlanFile {
  const p = object(input, [
    "format",
    "version",
    "id",
    "title",
    "revision",
    "source",
    "baseline",
    "document",
    "history",
    "baselines",
    "proposals",
    "explanations",
    "ownerMessages",
  ]);
  if (p.format !== PLAN_FORMAT || p.version !== PLAN_FORMAT_VERSION)
    throw new PlanError(
      "SCHEMA",
      `This plan file is not in the format this BaseSeer version reads (${PLAN_FORMAT} ${PLAN_FORMAT_VERSION}).`,
    );
  id(p.id);
  text(p.title, "project title", 200);
  const planRevision = revision(p.revision);
  id(p.source);
  const doc = document(p.document);
  let previous = -1;
  const history = list(p.history).map((h) => {
    const entry = historyEntry(h, previous, planRevision);
    previous = entry.revision;
    return entry;
  });
  const baselines = list(p.baselines).map((b) => baseline(b, planRevision));
  const baselineIds = new Set<string>();
  for (const b of baselines) {
    if (baselineIds.has(b.id)) throw new PlanError("INVALID", "Duplicate baseline");
    baselineIds.add(b.id);
  }
  if (p.baseline !== null && !baselineIds.has(id(p.baseline)))
    throw new PlanError("INVALID", "Selected baseline is missing");
  const proposals = list(p.proposals).map((q) => proposal(q, baselines));
  const proposalIds = new Set<string>();
  for (const q of proposals) {
    if (proposalIds.has(q.id)) throw new PlanError("INVALID", "Duplicate proposal");
    proposalIds.add(q.id);
  }
  for (const b of baselines)
    if (b.proposal && !proposalIds.has(b.proposal))
      throw new PlanError("INVALID", "Baseline proposal provenance is missing");
  const { explanations } = validateProjectMap({
    baseline: null,
    latest: null,
    explanations: p.explanations,
  });
  return {
    format: PLAN_FORMAT,
    version: PLAN_FORMAT_VERSION,
    id: p.id as string,
    title: p.title as string,
    revision: planRevision,
    source: p.source as string,
    baseline: p.baseline as string | null,
    document: doc,
    history,
    baselines,
    proposals,
    explanations,
    ownerMessages: list(p.ownerMessages).map(ownerMessage),
  };
}

export function readPlanFile(file: string): PlanFile {
  return json(fs.readFileSync(file, "utf8"), "plan file", validatePlanFile);
}

export function writePlanFile(file: string, plan: PlanFile) {
  stored("plan file", () => validatePlanFile(plan));
  writeFileAtomically(file, JSON.stringify(plan, null, 2) + "\n");
}

/** The plan as it stood before the entry at `index`: its own `before`, else the previous entry's result, else the empty plan. */
export function historyBefore(history: HistoryEntry[], index: number): Document {
  const entry = history[index];
  if (entry.before) return entry.before;
  return index > 0 ? history[index - 1].after : EMPTY_DOCUMENT;
}

/** Whether two plan documents are the same plan, field for field. */
export const sameDocument = (a: Document, b: Document) => canonical(a) === canonical(b);

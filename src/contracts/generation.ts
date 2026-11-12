// Codebase-generation envelopes and their coverage assessment. Validation stays
// with the application; these are the shapes other layers may read.
export type CandidateOperation = {
  id: string;
  name: string;
  path: string;
  sha256: string;
  startLine: number;
  endLine: number;
  origin: "source-declaration";
  selected: boolean;
  reason: string;
  scenarios: string[];
};
export type GenerationAssessment = {
  version: 1;
  run: string;
  scope: string;
  context: string;
  scanDigest: string;
  assessedAt: string;
  recordRevision: number;
  documentHash: string;
  explanationHash: string;
  state: "representative" | "partial" | "unassessed";
  scan: {
    files: number;
    partial: boolean;
    unsupported: number;
    parseErrors: number;
    unresolvedImports: number;
    exclusions: number;
  };
  areas: {
    path: string;
    files: number;
    explainedFiles: number;
    componentFiles: number;
  }[];
  deferredAreas: number;
  operations: CandidateOperation[];
  deferredOperations: number;
  selection: string;
  wholeProgramCoverage: "unknown";
  records: { id: string; version: number; hash: string }[];
  explanations: { id: string; hash: string }[];
  evidence: {
    statements?: {
      version: 1;
      total: number;
      anchored: number;
      staticBindings: number;
      gaps: number;
      unchecked: number;
    };
    status: "source-inferred-unverified";
    uncheckedClaims: number;
    independentVerification: "not-assessed";
  };
  gaps: {
    kind: string;
    view: "Code" | "Planning" | "Behavior" | "Review" | "Work";
    message: string;
  }[];
};
export type Generation = {
  id: string;
  key: string;
  plan: string;
  session: string;
  scope: string;
  status:
    | "scanning"
    | "generating"
    | "stopping"
    | "complete"
    | "needs-attention"
    | "cancelled";
  startedAt: string;
  finishedAt?: string;
  scan?: string;
  reason?: string;
  assessment?: GenerationAssessment;
  assessmentState?: "representative" | "partial" | "unassessed" | "stale";
  result?: {
    files: number;
    partial: boolean;
    explanations: number;
    connections: number;
    components: number;
    relationships: number;
    scenarios?: number;
    reviewItems?: number;
    followUps?: number;
    missing?: string[];
  };
};

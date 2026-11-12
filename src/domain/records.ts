import { PlanError, object, text, revision, at } from "./plan.ts";
import { modelPolicy, projectModelPolicy } from "./model-policy.ts";
import { materialStatements } from "./statement-support.ts";
import { workRoute } from "./work-automation.ts";

export const kinds = [
  "requirement",
  "component",
  "interface",
  "scenario",
  "decision",
  "question",
  "task",
  "sourceRoot",
  "snapshot",
  "mapping",
  "claim",
  "evidence",
  "finding",
  "analysis",
  "view",
  "artifact",
] as const;
export type Kind = (typeof kinds)[number];
export type RecordData = Record<string, any>;
export interface PlanningRecord {
  id: string;
  kind: Kind;
  version: number;
  title: string;
  status: "draft" | "accepted" | "superseded";
  data: RecordData;
}
export interface Link {
  id: string;
  kind: string;
  from: string;
  to: string;
  provenance: string;
  scope: string;
  evidence: string[];
}
export interface Document {
  records: PlanningRecord[];
  links: Link[];
}
export const fail = (message: string): never => {
  throw new PlanError("INVALID", message);
};
export function id(v: unknown): string {
  const s = text(v, "identity", 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s))
    fail(`Invalid identity ${JSON.stringify(s)}: use only letters, digits, "-", "_" and ".", starting with a letter or digit`);
  // Plans are kept in plain objects keyed by identity, where a name every object already has would read as present.
  if (s in Object.prototype)
    fail(`Invalid identity ${JSON.stringify(s)}: every JavaScript object already has that name; choose another`);
  return s;
}
export function relative(v: unknown): string {
  const s = text(v, "relative path", 500);
  if (
    !s ||
    s.includes("\\") ||
    s.includes(":") ||
    s.startsWith("/") ||
    s
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    fail("Expected a safe root-relative path");
  return s;
}
export function list(v: unknown): any[] {
  if (!Array.isArray(v) || v.length > 10000) fail("Expected a bounded array");
  return v as any[];
}
export function choice(v: unknown, values: readonly string[]): string {
  if (typeof v !== "string" || !values.includes(v))
    fail(`Expected ${values.join("/")}`);
  return v as string;
}
export function hash(v: unknown): string {
  const s = text(v, "SHA-256", 64);
  if (!/^[a-f0-9]{64}$/.test(s)) fail("Invalid SHA-256");
  return s;
}
export const c4Levels = ["person", "system", "container", "component"];
export const messageKinds = ["synchronous", "asynchronous", "reply"];
/** A shared-data name compares case- and spacing-insensitively. */
export const shapeName = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ");
const str = (v: unknown) => text(v, "record text", 16000);
const strings = (v: unknown) => list(v).map(str);
const ids = (v: unknown) => list(v).map(id);
const bool = (v: unknown) => {
  if (typeof v !== "boolean") fail("Expected boolean");
  return v;
};
const positive = (v: unknown) => {
  const n = revision(v);
  if (!n) fail("Expected positive integer");
  return n;
};
const optional = (f: (v: unknown) => unknown) => (v: unknown) =>
  v === undefined ? undefined : f(v);
const sourceReference = optional((v) => {
  const q = object(v, ["explanation", "context"]);
  return { explanation: id(q.explanation), context: hash(q.context) };
});
const statementSupport = optional((v) => {
  const q = object(v, ["version", "items"]);
  if (q.version !== 1) fail("Unsupported statement support version");
  const items = list(q.items);
  if (items.length > 400) fail("At most 400 statement references per record");
  const seen = new Set<string>();
  return {
    version: 1,
    items: items.map((raw) => {
      const x = object(raw, ["target", "citations", "gap", "relationship"]);
      const target = text(x.target, "statement selector", 160);
      if (seen.has(target)) fail("Duplicate statement selector");
      seen.add(target);
      const citations = list(x.citations).map((n) => {
        const index = revision(n);
        if (index > 7) fail("Citation index must be 0 through 7");
        return index;
      });
      if (citations.length > 8 || new Set(citations).size !== citations.length)
        fail("Use distinct citation indexes");
      const gap = text(x.gap, "support gap", 2000);
      if (!citations.length && !gap.trim())
        fail("Uncited statements need an explicit support gap");
      const rel =
        x.relationship === undefined
          ? undefined
          : object(x.relationship, [
              "path",
              "line",
              "column",
              "targetPath",
              "targetSymbol",
            ]);
      return {
        target,
        citations,
        gap,
        ...(rel
          ? {
              relationship: {
                path: relative(rel.path),
                line: positive(rel.line),
                column: revision(rel.column),
                targetPath: relative(rel.targetPath),
                targetSymbol: text(rel.targetSymbol, "target symbol", 500),
              },
            }
          : {}),
      };
    }),
  };
});
// Every text a build reads is a name or one or two plain sentences: the owner
// can read all of it at the go, and how a part works stays its builder's to
// decide from the owner's words, so no field holds a design in prose.
const contractFields = ["allowedDependencies", "sourceTargets"];
const contractNames = ["inputs", "outputs", "owns", "writes"];
const names = (what: string) => (v: unknown) => {
  const items = list(v).map((n) => text(n, what, 80).trim());
  if (items.length > 40 || items.some((n) => !n))
    fail(`List at most 40 ${what}s of at most 80 characters each: names, not descriptions`);
  return items;
};
const recordNames = names("record name");
const sentence = (what: string, max: number) => (v: unknown) => text(v, what, max);
const sentences = (what: string) => sentence(`${what} (one or two plain sentences)`, 300);
const scenarioText = sentences("scenario text");
/**
 * The project's structure, on the one decision that sets it: each part one
 * plain sentence the owner can judge and a build can follow. A build's
 * foundation is written to it, and the components' allowed dependencies
 * follow its dependency rule.
 */
const architecture = optional((v) => {
  const q = object(v, ["style", "dependencies", "state", "errors"]);
  const part = (name: string) => sentence(`architecture ${name} (one plain sentence)`, 200)(q[name]);
  return { style: part("style"), dependencies: part("dependencies"), state: part("state"), errors: part("errors") };
});
const scenarioTexts = (v: unknown) => list(v).map(scenarioText);
const fields: Record<Kind, Record<string, (v: any) => unknown>> = {
  requirement: {
    rationale: sentences("rationale"),
    scope: sentences("scope"),
    priority: (v) => choice(v, ["must", "should", "could"]),
  },
  component: {
    source: sourceReference,
    support: statementSupport,
    observed: optional((v) => {
      const q = object(v, ["paths", "inputs", "outputs", "state"]);
      const paths = list(q.paths).map(relative);
      if (paths.length > 80)
        fail("Observed component mapping exceeds 80 files");
      return {
        paths,
        inputs: strings(q.inputs),
        outputs: strings(q.outputs),
        state: strings(q.state),
      };
    }),
    responsibility: sentence("responsibility (one plain sentence)", 80),
    contract: optional((v) => {
      const q = object(v, [...contractFields, ...contractNames]);
      const missing = contractFields.filter((name) => q[name] === undefined);
      if (missing.length)
        fail(
          `Missing required arrays: ${missing.join(", ")}. A contract lists its files and what it uses; use [] only when explicitly empty.`,
        );
      return {
        allowedDependencies: at("allowedDependencies", () =>
          ids(q.allowedDependencies),
        ),
        sourceTargets: at("sourceTargets", () =>
          list(q.sourceTargets).map(relative),
        ),
        ...Object.fromEntries(
          contractNames
            .filter((name) => q[name] !== undefined)
            .map((name) => [name, at(name, () => recordNames(q[name]))]),
        ),
      };
    }),
    // Optional C4 classification and containment. Display only:
    // neither field grants dependencies, source ownership or verification.
    c4: optional((v) => {
      const q = object(v, ["level", "external"]);
      return {
        level: choice(q.level, c4Levels),
        external: q.external === undefined ? false : bool(q.external),
      };
    }),
    parent: optional(id),
    technology: optional((v) => text(v, "component technology", 60)),
    // The model the planner chose to build this component.
    build: optional(workRoute),
    // A screen this component renders: what it is for, its main action and
    // what the owner must see or be able to do on it. How it is laid out is
    // its builder's, from the owner's words.
    screen: optional((v) => {
      const q = object(v, ["purpose", "primaryAction", "checks"]);
      const purpose = sentences("screen purpose")(q.purpose).trim();
      if (!purpose) fail("Say what the screen is for");
      const checks =
        q.checks === undefined
          ? undefined
          : at("checks", () => {
              const items = list(q.checks).map((x) =>
                sentence("screen check (one plain sentence)", 160)(x).trim(),
              );
              if (items.length > 20 || items.some((x) => !x))
                fail("List at most 20 checks, none empty");
              return items;
            });
      return {
        purpose,
        ...(q.primaryAction === undefined
          ? {}
          : {
              primaryAction: text(
                q.primaryAction,
                "screen primary action",
                120,
              ).trim(),
            }),
        ...(checks ? { checks } : {}),
      };
    }),
  },
  interface: {
    // What crosses it, for the owner and the diagrams; the records that cross
    // it are its shapes, by name and fields.
    responsibility: sentence("responsibility (one plain sentence saying what crosses it)", 160),
    format: sentence("format (a short protocol or data format label)", 60),
    // The agreed shape of records more than one component reads or writes.
    shapes: optional((v) => {
      const items = list(v);
      if (items.length > 40) fail("At most 40 shapes per interface");
      const seen = new Set<string>();
      return items.map((raw, i) =>
        at(`shapes[${i}]`, () => {
          const q = object(raw, ["name", "fields", "version"]);
          const name = text(q.name, "shape name", 80).trim();
          if (!name) fail("Name the shape");
          if (seen.has(shapeName(name))) fail(`Duplicate shape ${name}`);
          seen.add(shapeName(name));
          const fields = list(q.fields).map((x) =>
            text(x, "shape field (a name and its type)", 120).trim(),
          );
          if (!fields.length || fields.length > 100 || fields.some((x) => !x))
            fail('List 1 to 100 fields, e.g. "title: string, required"');
          return {
            name,
            fields,
            ...(q.version === undefined
              ? {}
              : { version: text(q.version, "shape version", 40) }),
          };
        }),
      );
    }),
  },
  scenario: {
    support: statementSupport,
    source: optional((v) => {
      const q = object(v, ["explanation", "context", "operation"]);
      const operation =
        q.operation === undefined
          ? undefined
          : object(q.operation, ["path", "line"]);
      return {
        explanation: id(q.explanation),
        context: hash(q.context),
        ...(operation
          ? {
              operation: {
                path: relative(operation.path),
                line: positive(operation.line),
              },
            }
          : {}),
      };
    }),
    trigger: scenarioText,
    preconditions: scenarioTexts,
    steps: (v) =>
      list(v).map((s) => {
        const q = object(s, ["component", "action", "outcome"]);
        return {
          component: optional(id)(q.component),
          action: scenarioText(q.action),
          outcome: scenarioText(q.outcome),
        };
      }),
    errors: scenarioTexts,
    recovery: scenarioText,
    flow: optional((v) => {
      const q = object(v, ["entry", "nodes", "transitions", "messages"]);
      const nodes = list(q.nodes).map((n) => {
        const x = object(n, [
          "id",
          "component",
          "action",
          "state",
          "data",
          "terminal",
        ]);
        return {
          id: id(x.id),
          component: optional(id)(x.component),
          action: scenarioText(x.action),
          state: scenarioText(x.state),
          data: scenarioText(x.data),
          terminal: bool(x.terminal),
        };
      });
      const names = new Set(nodes.map((n) => n.id));
      if (names.size !== nodes.length || !names.has(id(q.entry)))
        fail("Flow needs unique nodes and a valid entry");
      const transitions = list(q.transitions).map((t) => {
        const x = object(t, ["from", "to", "condition", "data", "kind"]);
        if (!names.has(id(x.from)) || !names.has(id(x.to)))
          fail("Flow transition has a missing endpoint");
        return {
          from: id(x.from),
          to: id(x.to),
          condition: scenarioText(x.condition),
          data: scenarioText(x.data),
          kind: choice(x.kind, ["success", "failure", "recovery", "next"]),
        };
      });
      if (transitions.some((t) => nodes.find((n) => n.id === t.from)?.terminal))
        fail("Terminal flow nodes cannot have outgoing transitions");
      // Explicit send/receive records. They are separate from
      // transitions: a transition orders steps, a message is a communication.
      const messages =
        q.messages === undefined
          ? []
          : list(q.messages).map((m) => {
              const x = object(m, [
                "id",
                "send",
                "receive",
                "kind",
                "label",
                "guard",
              ]);
              const send = id(x.send),
                receive = id(x.receive);
              if (!names.has(send) || !names.has(receive))
                fail("Flow message has a missing send or receive node");
              if (send === receive)
                fail("Flow message needs distinct send and receive nodes");
              return {
                id: id(x.id),
                send,
                receive,
                kind: choice(x.kind, messageKinds),
                label: scenarioText(x.label),
                ...(x.guard === undefined ? {} : { guard: scenarioText(x.guard) }),
              };
            });
      if (new Set(messages.map((m) => m.id)).size !== messages.length)
        fail("Flow messages need unique IDs");
      return {
        entry: id(q.entry),
        nodes,
        transitions,
        ...(messages.length ? { messages } : {}),
      };
    }),
  },
  decision: {
    modelPolicy,
    lead: optional(workRoute),
    architecture,
    context: sentences("context"),
    choice: sentences("choice"),
    alternatives: names("alternative"),
    supersedes: optional(id),
  },
  question: { question: str, owner: str },
  task: {
    scope: str,
    checks: strings,
    dependencies: ids,
    criteria: (v) =>
      list(v).map((c) => {
        const q = object(c, ["requirement", "version"]);
        return { requirement: id(q.requirement), version: positive(q.version) };
      }),
    state: (v) => choice(v, ["planned", "ready-for-review", "cancelled"]),
  },
  sourceRoot: { repository: id, label: str },
  snapshot: {
    root: id,
    branch: str,
    commit: str,
    tree: str,
    digest: hash,
    dirty: bool,
    files: (v) => {
      const q = object(v, Object.keys(v ?? {}));
      if (Object.keys(q).length > 10000) fail("Too many source files");
      return Object.fromEntries(
        Object.entries(q).map(([k, h]) => [relative(k), hash(h)]),
      );
    },
    configuration: hash,
    sourceAvailability: (v) => choice(v, ["separate", "included", "missing"]),
  },
  mapping: {
    root: id,
    path: relative,
    startLine: positive,
    endLine: positive,
    symbol: optional(str),
    language: optional(str),
    snapshot: id,
  },
  claim: {
    source: sourceReference,
    statement: str,
    subject: id,
    origin: (v) =>
      choice(v, [
        "human-assertion",
        "agent-inference",
        "static-extraction",
        "test-execution",
        "runtime-observation",
        "review",
      ]),
    assessment: (v) =>
      choice(v, ["unchecked", "supported", "contradicted", "inconclusive"]),
    scope: str,
    snapshot: optional(id),
    dependencies: ids,
  },
  evidence: {
    inputs: optional((v) =>
      list(v).map((item) => {
        const q = object(item, ["record", "version"]);
        return { record: id(q.record), version: positive(q.version) };
      }),
    ),
    method: str,
    actor: str,
    tool: str,
    toolVersion: str,
    time: (v) => {
      const s = str(v);
      if (!Number.isFinite(Date.parse(s))) fail("Invalid evidence time");
      return s;
    },
    scope: str,
    result: str,
    snapshot: id,
    assessment: (v) =>
      choice(v, ["unchecked", "supported", "contradicted", "inconclusive"]),
    artifacts: ids,
  },
  finding: {
    source: sourceReference,
    coverage: optional((v) =>
      choice(v, [
        "scope-limit",
        "unchecked-interpretation",
        "source-discrepancy",
      ]),
    ),
    subjects: optional(ids),
    description: str,
    severity: (v) => choice(v, ["info", "warning", "error"]),
    resolution: str,
  },
  analysis: {
    snapshot: id,
    tool: str,
    version: str,
    capability: str,
    outcome: (v) =>
      choice(v, ["completed", "partial", "failed", "not-run", "unsupported"]),
    gaps: strings,
    scope: str,
  },
  view: {
    view: (v) => choice(v, ["plan", "structure", "behavior"]),
    positions: (v) =>
      list(v).map((p) => {
        const q = object(p, ["record", "x", "y", "group"]);
        if (
          ![q.x, q.y].every(
            (n) =>
              typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6,
          )
        )
          fail("Invalid view position");
        return {
          record: id(q.record),
          x: q.x,
          y: q.y,
          group: optional(str)(q.group),
        };
      }),
    pinned: ids,
    filters: strings,
  },
  artifact: {
    sha256: optional(hash),
    size: revision,
    mediaType: str,
    state: (v) =>
      choice(v, [
        "included",
        "excluded-sensitive",
        "excluded-size",
        "unavailable",
        "intentionally-omitted",
      ]),
    reason: str,
    reviewed: bool,
  },
};
export function record(input: unknown): PlanningRecord {
  const q = object(input, ["id", "kind", "version", "title", "status", "data"]);
  const recordId = at("Record id", () => id(q.id));
  const location = (name: string) => `Record ${recordId}.${name}`;
  const kind = at(location("kind"), () => choice(q.kind, kinds)) as Kind;
  const schema = fields[kind],
    data = at(location("data"), () => object(q.data, Object.keys(schema)));
  // Each field's error names the record and the field, and the record is
  // refused with all of them, so the writer fixes every one in its next write.
  const problems: string[] = [];
  const field = <T>(name: string, validate: () => T): T | undefined => {
    try {
      return at(location(name), validate);
    } catch (error) {
      if (!(error instanceof PlanError)) throw error;
      problems.push(error.message);
      return undefined;
    }
  };
  const r = {
    id: recordId,
    kind,
    version: field("version (required positive integer; use 1 for a new record)", () => positive(q.version)),
    title: field("title", () => text(q.title, "title", 200)),
    status: field("status", () =>
      choice(q.status, ["draft", "accepted", "superseded"]),
    ) as PlanningRecord["status"],
    data: Object.fromEntries(
      Object.entries(schema)
        .map(([name, fn]) => [name, field(`data.${name}`, () => fn(data[name]))])
        .filter(([, v]) => v !== undefined),
    ),
  };
  if (problems.length) fail(problems.join("\n"));
  if (kind === "mapping" && r.data.endLine < r.data.startLine)
    fail("Reversed source range");
  if (r.data.support) {
    if (!r.data.source)
      fail("Statement support requires a source explanation binding");
    const targets = new Set(materialStatements(r).map((s) => s.target));
    for (const item of r.data.support.items)
      if (!targets.has(item.target))
        fail(`Unknown or empty statement: ${item.target}`);
  }
  if (r.data.observed && !r.data.source)
    fail("Observed component mapping requires a source explanation binding");
  if (
    kind === "artifact" &&
    r.data.state === "included" &&
    (!r.data.sha256 || !r.data.reviewed)
  )
    fail("Included artifacts require review and a content hash");
  return JSON.parse(canonical(r)) as PlanningRecord;
}
export const linkRules: Record<string, [readonly Kind[], readonly Kind[]]> = {
  satisfies: [["component", "scenario", "task"], ["requirement"]],
  "depends-on": [["task"], ["task"]],
  implements: [["component"], ["interface"]],
  uses: [
    ["component", "scenario", "interface"],
    ["component", "interface"],
  ],
  "maps-to": [["component", "interface", "task", "scenario"], ["mapping"]],
  supports: [["evidence"], ["claim", "requirement", "finding"]],
  contradicts: [["evidence"], ["claim", "requirement", "finding"]],
  addresses: [
    ["decision", "task", "question"],
    ["requirement", "component", "finding", "question"],
  ],
};
export function recordGuide() {
  return {
    fields: Object.fromEntries(
      Object.entries(fields).map(([kind, shape]) => [kind, Object.keys(shape)]),
    ),
    componentContract: {
      required: contractFields,
      shape: {
        allowedDependencies: "component/interface ID[]",
        sourceTargets: "safe root-relative file path[]",
      },
      optional: {
        inputs: "names of the records or shapes it takes in",
        outputs: "names of the records or shapes it gives out",
        owns: "names of the records it owns",
        writes:
          "names of shared records this component creates or changes that another component also writes",
      },
      instruction:
        "component.data.contract is optional, but when supplied sourceTargets and allowedDependencies are required. Use [] only for an explicitly empty field; allowedDependencies:[] forbids dependencies. The optional lists hold names of at most 80 characters, not descriptions: a contract names the files, uses and records of a part, and how the part works is its builder's to decide from the owner's words.",
    },
    sharedShapes:
      'When more than one component creates or changes the same kind of record, give that record one agreed shape: interface.data.shapes:[{name:"template",fields:["id: string, required","title: string, required",...],version?:"1"}] on an interface every writer links to (implements/uses), and list the name in the contract.writes of each writer. A shape names its fields and their types; what a record must satisfy is its builders\', from the owner\'s words. plan_build reports a shared name with no shape as a problem.',
    plannedScreens:
      'For an app with a user interface, on the component that renders each screen add component.data.screen:{purpose:"what the screen is for, in one or two plain sentences",primaryAction?:"its one main action",checks?:["what the owner must see or be able to do, one plain sentence each"]}. Its layout and states are its builder\'s, from the owner\'s words.',
    plannedModels:
      'Give every component the model that builds it: component.data.build:{model:"provider/model",thinking:<exact thinking ID>}, and the build its lead in one decision with data.lead:{model,thinking}: the session that builds the project on the owner\'s go, starting a subagent on each component\'s model. Choose each from plan_models capabilities under the owner\'s model policy (plan_guide model-selection).',
    plannedArchitecture:
      'Give the project its structure in one decision with data.architecture:{style,dependencies,state,errors}, one plain sentence each (at most 200 characters): style names the structure and why it fits this project, as small as the project allows ("One module; nothing to separate" is a valid style); dependencies says which kinds of part may use which and which way dependencies point; state says where data lives and which part owns it; errors says how a failure travels from where it happens to what the user sees. Every component\'s contract.allowedDependencies follows the dependencies rule. plan_build reports a plan without it as a problem (plan_guide architecture).',
    link: '{id,kind,from,to,provenance,scope,evidence}, all required: id a short name of its own; kind one of linkDirections; from and to record ids; provenance where the relationship comes from (the owner, a decision, the source) in a few words; scope why it exists, in a sentence; evidence [] unless it cites evidence records.',
    linkDirections: linkRules,
    taskStates: ["planned", "ready-for-review", "cancelled"],
    changePreview:
      '{op:"preview",command:{<any write command>}} runs that exact command and rolls it back: no revision, history or record change.',
    evidenceRule:
      "Planner assertions stay unchecked. Only the inspection and verification adapters create trusted source/execution records. Link their evidence; do not recreate it.",
    sourceCoverage:
      "Source-inferred component, finding and claim records may also use data.source:{explanation:<current plan_code explain id>,context:<returned context>}. Required to count them toward generation coverage. Bind only to explanations citing that record's relevant files. Current source references establish location, not truth; retain unchecked claims and known omissions.",
    statementSupport:
      'For source-inferred scenarios/components add data.support:{version:1,items:[{target:"nodes.save.action",citations:[0],gap:""}]}. Each target names exactly one nonempty statement: trigger, preconditions.N, steps.N.action/outcome, errors.N, recovery, nodes.NODE_ID.action/state/data, transitions.N.condition/data, messages.MESSAGE_ID.label/guard; for components responsibility, observed.inputs.N/outputs.N/state.N. N and citation indexes start at zero. Citations index this record\'s own source explanation (0–7); uncited items need a specific gap. Every material statement must have its own support or explicit gap. Missing items remain visible gaps. Optional relationship:{path,line,column,targetPath,targetSymbol} cites a real LanguageAnalysis relationship start (one-based line, zero-based UTF-8 column) and its exact target symbol id from plan_code file. Cite both source site and target declaration. Wrong resolved targets are rejected; unresolved sites stay unchecked. No field can assert semantic verification or execution. Quotes validate locations only; all interpretations stay unchecked.',
    observedComponents:
      'Source-inferred components use observed:{paths:["relative/file.ts"],inputs:["..."],outputs:["..."],state:["..."]}. Cite these paths and statements. This is observed mapping, NOT contract.sourceTargets or allowedDependencies. Preserve intended contracts; propose responsibilities separately and do not manufacture contracts to authorize existing imports.',
    currentReview:
      'Source-inferred findings need coverage:"scope-limit"|"unchecked-interpretation"|"source-discrepancy" and subjects:[component/scenario/claim IDs] with overlapping current source. Informational limitations are valid findings. Unchecked claims need a relevant source-bound subject and supporting dependencies. Old unrelated records do not close current Review coverage.',
    sourceOperation:
      "To represent a known generation operation candidate, scenario.data.source also needs operation:{path:<relative file>,line:<declaration start line>}. Cite that declaration in the referenced explanation. The server validates the candidate and citation; a broad explanation alone cannot label every operation as represented. Existing scenarios without this binding stay readable and do not count for selected-operation coverage.",
    componentDescriptions:
      "For new writes, technology is REQUIRED for every container, component and external system (not people), including data.c4:{level:system,external:true}. component.data.technology: name concretely what it is and, if it stores data, where and in what format, at most 60 characters, based on intended design or cited source rather than guessing. Examples: JavaScript module, HTML/CSS/JavaScript page, Web browser + localStorage (JSON), PostgreSQL database, SQLite file, Python web service (FastAPI), Stripe payment API. Never use vague labels like platform, environment or facility, or C4 vocabulary alone as the answer. component.data.responsibility: one plain sentence, at most 12 words / 80 characters, saying what it does for the user; no Provides the or implementation jargon such as origin-scoped, execution environment or adapter. Where a part sits is its c4 level and parent; source uncertainty belongs in source explanations. Scenario/flow step titles (steps.action and flow.nodes.action) and trigger text: at most 10 words each, plain; details belong in step notes (outcome, state and data). interface.data.responsibility: one plain sentence, at most 160 characters, saying what crosses it. interface.data.format: a short concrete protocol or data format label of at most 60 characters, such as JSON in browser localStorage, JavaScript function calls, REST over HTTPS or SQLite table. Technology is display metadata, not proof of implementation or verification.",
    notations:
      'Standard-notation data. Whenever the planner creates or updates a component, include component.data.c4:{level:"person"|"system"|"container"|"component",external?:boolean}; mark people and outside systems external:true. Include component.data.parent:<component ID> wherever it sits inside another recorded component (a container inside its system, a component inside its container); no cycles. Add the people and outside systems involved in the design as person/system components (for example the app user, browser or storage where appropriate). Classify existing unclassified components when next editing the plan; a receipt nudge asks for classification in the next write. scenario.data.flow.messages:[{id,send:<node ID>,receive:<different node ID>,kind:"synchronous"|"asynchronous"|"reply",label,guard?}] records explicit communications between participants for the UML Sequence view; they are separate from transitions and do not replace them. Record these only for actual intended design or cited source. They are display classifications, not dependencies, contracts or verification; an unclassified part is drawn inside the planned software system.',
    sourceScenario:
      "For behavior inferred from an existing codebase, first save a cited plan_code explanation, then set scenario.data.source:{explanation:<returned id>,context:<returned context>}. The server checks the reference. Include trigger, preconditions, steps, errors, recovery and a connected flow with component IDs, state/data and supported branches. The interpretation remains inferred, not accepted intent or executed proof. Omit source for ordinary intended scenarios.",
  };
}
export function link(input: unknown): Link {
  const q = object(input, [
    "id",
    "kind",
    "from",
    "to",
    "provenance",
    "scope",
    "evidence",
  ]);
  const linkId = at("Link id (required: a short name of its own)", () => id(q.id));
  // Every error names the link and the field, so the writer can fix it.
  const field = <T>(name: string, validate: () => T) => at(`Link ${linkId}.${name}`, validate);
  return {
    id: linkId,
    kind: field("kind", () => choice(q.kind, Object.keys(linkRules))),
    from: field("from (a record id)", () => id(q.from)),
    to: field("to (a record id)", () => id(q.to)),
    provenance: field("provenance (required: where the relationship comes from, in a few words)", () =>
      str(q.provenance),
    ),
    scope: field("scope (required: why the relationship exists, in a sentence)", () => str(q.scope)),
    evidence: field("evidence (use [] when there is no evidence)", () => ids(q.evidence)),
  };
}
export function document(input: unknown): Document {
  const q = object(input, ["records", "links"]),
    records = list(q.records).map(record),
    links = list(q.links).map(link);
  projectModelPolicy({ records });
  const byId = new Map(records.map((r) => [r.id, r]));
  if (
    byId.size !== records.length ||
    new Set(links.map((l) => l.id)).size !== links.length
  )
    fail("Duplicate record/relationship identity");
  const ref = (key: string, allowed: readonly Kind[] = kinds) => {
    const r = byId.get(key);
    if (!r || !allowed.includes(r.kind))
      fail(
        `Invalid reference ${key}: expected ${allowed.join("/")}; found ${r?.kind ?? "missing record"}`,
      );
    return r!;
  };
  // A reference's error names the record that holds it.
  for (const r of records)
    at(`Record ${r.id}`, () => {
      const d = r.data;
      switch (r.kind) {
        case "component":
          r.data.contract?.allowedDependencies.forEach((x: string) =>
            ref(x, ["component", "interface"]),
          );
          if (d.parent) {
            ref(d.parent, ["component"]);
            const seen = new Set([r.id]);
            for (let p = d.parent; p; p = byId.get(p)?.data.parent) {
              if (seen.has(p)) fail(`Component containment cycle at ${r.id}`);
              seen.add(p);
            }
          }
          break;
        case "finding":
          d.subjects?.forEach((x: string) =>
            ref(x, ["component", "scenario", "claim"]),
          );
          break;
        case "scenario":
          for (const s of d.steps)
            if (s.component) ref(s.component, ["component", "interface"]);
          for (const s of d.flow?.nodes ?? [])
            if (s.component) ref(s.component, ["component", "interface"]);
          break;
        case "decision":
          if (d.supersedes) ref(d.supersedes, ["decision"]);
          break;
        case "task":
          d.dependencies.forEach((x: string) => ref(x, ["task"]));
          d.criteria.forEach((x: any) => {
            if (ref(x.requirement, ["requirement"]).version < x.version)
              fail("Criterion version does not exist");
          });
          break;
        case "snapshot":
          ref(d.root, ["sourceRoot"]);
          break;
        case "mapping":
          ref(d.root, ["sourceRoot"]);
          if (ref(d.snapshot, ["snapshot"]).data.root !== d.root)
            fail("Source mapping crosses roots");
          break;
        case "claim":
          ref(d.subject);
          d.dependencies.forEach((x: string) => ref(x));
          if (d.snapshot) ref(d.snapshot, ["snapshot"]);
          break;
        case "evidence":
          ref(d.snapshot, ["snapshot"]);
          d.artifacts.forEach((x: string) => ref(x, ["artifact"]));
          break;
        case "analysis":
          ref(d.snapshot, ["snapshot"]);
          break;
        case "view":
          d.pinned.forEach((x: string) => ref(x));
          d.positions.forEach((x: any) => ref(x.record));
          break;
      }
    });
  for (const l of links) {
    const rule = linkRules[l.kind];
    at(`Link ${l.id} (${l.kind}).from`, () => ref(l.from, rule[0]));
    at(`Link ${l.id} (${l.kind}).to`, () => ref(l.to, rule[1]));
    l.evidence.forEach((e) => ref(e, ["evidence"]));
  }
  const graph = new Map(
    records
      .filter((r) => r.kind === "task")
      .map((r) => [r.id, [...r.data.dependencies] as string[]]),
  );
  for (const l of links)
    if (l.kind === "depends-on") graph.get(l.from)!.push(l.to);
  const visit = (n: string, chain: Set<string>, done: Set<string>) => {
    if (chain.has(n)) fail("Task dependency cycle");
    if (done.has(n)) return;
    chain.add(n);
    for (const to of graph.get(n) ?? []) visit(to, chain, done);
    chain.delete(n);
    done.add(n);
  };
  const done = new Set<string>();
  for (const n of graph.keys()) visit(n, new Set(), done);
  return {
    records: records.sort((a, b) => a.id.localeCompare(b.id)),
    links: links.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
/**
 * Whether code one component owns may import code another owns: its contract
 * allows it, or one sits directly inside the other, since a container's own
 * files are shared by the parts inside it.
 */
export function mayUse(user: PlanningRecord, used: PlanningRecord) {
  return (
    !!user.data.contract?.allowedDependencies.includes(used.id) ||
    used.data.parent === user.id ||
    user.data.parent === used.id
  );
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}

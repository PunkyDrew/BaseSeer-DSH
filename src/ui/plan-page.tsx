import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlanningRecord } from "../domain/records.ts";
import { PlanItems } from "./plan-items.tsx";
import { SelectedPlanItem } from "./workspace-detail.tsx";
import { recordLinks, type GraphItem } from "./graph-model.ts";
import { recordBody } from "./workspace-records.tsx";
import type { SourceRequest } from "./source-view.tsx";
import type { Notation } from "./notations/types.ts";
import { ActivityDiagram } from "./notations/ActivityDiagram.tsx";
import { SequenceDiagram } from "./notations/SequenceDiagram.tsx";
import { StructuralDiagram } from "./notations/StructuralDiagram.tsx";
import { ScenarioMatrix } from "./notations/ScenarioMatrix.tsx";
import { NotationKey } from "./notations/NotationKey.tsx";
import { scenarioModel, scenariosThrough } from "./notations/scenario.ts";
import { partColor } from "./graph-presentation.ts";
import {
  containmentIndex,
  projectPartLinks,
  projectStructural,
} from "./notations/structural.ts";
import { projectRecords } from "./notations/records.ts";
import { projectDeployment } from "./notations/deployment.ts";
import type { StructuralProjection } from "./notations/types.ts";
import type { GraphSizes } from "./use-graph-measurements.ts";
import { graphStyles } from "./graph-styles.ts";
import type {
  GraphNavigation,
  ViewName,
  WorkspaceState,
} from "./workspace-contract.ts";

type PlanSection = "Structure" | "Behavior";
type View = { section: PlanSection; notation: Notation; label: string };
// The plan's pictures: five UML diagrams (its structure, its records, where
// it runs, and a flow drawn two ways) and a table of its parts against its flows.
const families: { name: string; views: View[] }[] = [
  {
    name: "UML",
    views: [
      { section: "Structure", notation: "uml-component", label: "Component" },
      { section: "Structure", notation: "uml-class", label: "Records" },
      { section: "Structure", notation: "uml-deployment", label: "Deployment" },
      { section: "Behavior", notation: "flow", label: "Flows" },
      { section: "Behavior", notation: "uml-sequence", label: "Sequence" },
    ],
  },
  {
    name: "Table",
    views: [{ section: "Behavior", notation: "matrix", label: "Matrix" }],
  },
];
const defaultNotation: Record<PlanSection, Notation> = {
  Structure: "uml-component",
  Behavior: "flow",
};
const viewKey = (view: Pick<View, "section" | "notation">) =>
  `${view.section}:${view.notation}`;
const partKinds = ["component", "interface"];

export function PlanPage({
  section,
  state,
  navigation,
  onNavigation,
  focus,
  open,
  showView,
  status,
  discuss,
  openSource,
  history,
}: {
  section: PlanSection;
  state: WorkspaceState & { plan: NonNullable<WorkspaceState["plan"]> };
  navigation: GraphNavigation;
  onNavigation: (value: GraphNavigation) => void;
  /** A record another page asked to show here. */
  focus: { view: ViewName; id: string; serial: number } | null;
  /** Shows a record on the page it belongs to; here, the other plan section. */
  open: (id: string) => void;
  /** Shows one of the pictures, switching section when it needs to. */
  showView: (section: PlanSection, notation: Notation, also?: GraphNavigation) => void;
  status: (record: PlanningRecord) => string;
  discuss: (id: string, title: string) => Promise<unknown>;
  openSource: (request: SourceRequest, origin: HTMLElement) => void;
  /** The plan's history, folded under the items list. */
  history: React.ReactNode;
}) {
  const plan = state.plan,
    doc = plan.document,
    records = doc.records,
    links = recordLinks(doc);
  const byId = (id: string) => records.find((r) => r.id === id);
  const notation = navigation.notation ?? defaultNotation[section];
  // Flows: every scenario, or those the chosen part (or a part inside it) takes a step in.
  const part = byId(navigation.part ?? "") ? navigation.part! : "";
  const signature = JSON.stringify(doc);
  const scenarios = useMemo(
    () => (part ? scenariosThrough(doc, part) : records.filter((r) => r.kind === "scenario")),
    [signature, part],
  );
  const scenario =
    scenarios.find((r) => r.id === navigation.scenario) ?? scenarios[0];
  const focusParts = useMemo(() => {
    const { ancestors } = containmentIndex(records);
    return new Set(
      part
        ? [part, ...[...ancestors].filter(([, up]) => up.includes(part)).map(([id]) => id)]
        : [],
    );
  }, [signature, part]);
  const layers = {
    traceability: navigation.layers?.traceability ?? false,
    sources: navigation.layers?.sources ?? false,
  };
  const selected = navigation.selected ?? "";
  // A diagram element carries more than its record (a step, a merged arrow,
  // a rolled-up box); the diagram reports it when the selection is made there.
  const [graphItem, setGraphItem] = useState<GraphItem | null>(null);
  const select = (item: GraphItem | null, id = item?.record ?? "") => {
    setGraphItem(item);
    const record = byId(id);
    onNavigation({
      selected: id,
      // A scenario chosen anywhere is the flow drawn here.
      ...(record?.kind === "scenario"
        ? { scenario: id, ...(scenarios.includes(record) ? {} : { part: "" }) }
        : {}),
    });
  };
  // Flows, opened from another picture.
  const toFlows = (also: GraphNavigation) => {
    setGraphItem(null);
    showView("Behavior", "flow", also);
  };
  // Choosing a part breaks it down into the flows it takes part in. The flow
  // on show stays when the part is in it; a part in no flow shows its links.
  const openFlows = (id: string) => {
    const through = id ? scenariosThrough(doc, id) : records.filter((r) => r.kind === "scenario");
    const also: GraphNavigation = {
      part: id,
      selected: id,
      scenario: through.find((r) => r.id === scenario?.id)?.id ?? through[0]?.id ?? "",
    };
    if (section === "Behavior" && notation !== "matrix") {
      setGraphItem(null);
      onNavigation(also);
    } else toFlows(also);
  };
  useEffect(() => {
    if (focus) select(null, focus.id);
  }, [focus?.serial]);
  useEffect(() => {
    if (selected && !byId(selected) && !graphItem) select(null);
  }, [doc]);
  const current = byId(selected);
  const kind = current?.kind ?? "";
  useEffect(() => {
    // Requirements, decisions and questions are drawn only with their layer on.
    if (
      notation === "uml-component" &&
      ["requirement", "decision", "question"].includes(kind) &&
      !layers.traceability
    )
      onNavigation({ layers: { ...layers, traceability: true } });
  }, [selected]);
  const chooseView = (view: View) => {
    setGraphItem(null);
    showView(view.section, view.notation);
  };
  // A box that stands for parts opens their flows; anything else opens its details.
  const onDiagramSelect = (item: GraphItem | null) => {
    if (!item) return select(null);
    const isPart =
      !item.link &&
      item.id === item.record &&
      partKinds.includes(byId(item.record)?.kind ?? "");
    if (isPart && !(section === "Behavior" && item.record === part)) openFlows(item.record ?? "");
    else select(item, item.link ? "" : (item.record ?? ""));
  };
  const popId = useId().replaceAll(":", "");
  const [layersOpen, setLayersOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    const outside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setLayersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayersOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [layersOpen]);
  const ref = (id: string) => {
    const record = byId(id);
    if (!record) return <span>{id}</span>;
    return (
      <button
        className="bpv-link"
        onClick={(event) => {
          if (record.kind === "mapping")
            openSource(
              {
                kind: "snapshot",
                title: record.title,
                path: record.data.path,
                digest: byId(record.data.snapshot)?.data.digest,
                startLine: record.data.startLine,
                endLine: record.data.endLine,
              },
              event.currentTarget,
            );
          else if (record.kind === "scenario" && section !== "Behavior")
            open(id);
          else select(null, id);
        }}
      >
        {record.title}
      </button>
    );
  };
  const showDetail = !!current || !!graphItem;
  // On a narrow panel the details open as a sheet over the diagram's bottom;
  // the diagram is told how much it covers so the selection stays in view.
  const canvas = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const sheet = side.current,
      area = canvas.current;
    if (!sheet || !area) return;
    const measure = () =>
      setInset(
        showDetail && getComputedStyle(sheet).position === "sticky"
          ? Math.max(
              0,
              Math.round(
                area.getBoundingClientRect().bottom -
                  sheet.getBoundingClientRect().top,
              ),
            )
          : 0,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [showDetail, selected, graphItem?.id]);
  const shown = graphItem?.id ?? selected;
  // A flow's key names each part beside the hue its lane wears.
  const lanes =
    section === "Behavior" && notation !== "matrix" && scenario
      ? [...new Set(scenarioModel(scenario).steps.map((s) => s.part))]
          .filter(Boolean)
          .map((part) => ({ title: byId(part)?.title ?? part, color: partColor(doc, part) }))
      : [];
  const key = (links = false) => (
    <NotationKey
      notation={notation}
      links={links}
      parts={lanes}
      layers={notation === "uml-component" ? layers : undefined}
    />
  );
  // A structure picture of the whole plan; empty, it offers the next picture to look at.
  const structural = (
    kind: "cmp" | "class" | "dep",
    project: (sizes: GraphSizes) => StructuralProjection,
    title: string,
  ) => (
    <StructuralDiagram
      key={notation}
      kind={kind}
      project={project}
      signature={`${signature}${JSON.stringify(records.map(status))}${JSON.stringify(layers)}`}
      heading={plan.title}
      selected={shown}
      onSelect={onDiagramSelect}
      onFallback={() => chooseView(families[0].views[kind === "cmp" ? 3 : 0])}
      fallback={kind === "cmp" ? "Show flows" : "Show components"}
      legend={key()}
      inset={inset}
      title={title}
    />
  );
  const diagram =
    notation === "matrix" ? (
      <ScenarioMatrix
        document={doc}
        onPart={openFlows}
        onScenario={(id) => toFlows({ part: "", scenario: id, selected: id })}
        onCell={(id, scenario) => toFlows({ part: id, scenario, selected: id })}
      />
    ) : section === "Behavior" ? (
      scenario ? (
        notation === "uml-sequence" ? (
          <SequenceDiagram
            key={scenario.id}
            document={doc}
            scenario={scenario}
            focus={focusParts}
            selected={shown}
            onSelect={onDiagramSelect}
            legend={key()}
            inset={inset}
            title={scenario.title}
          />
        ) : (
          <ActivityDiagram
            key={scenario.id}
            document={doc}
            scenario={scenario}
            focus={focusParts}
            selected={shown}
            onSelect={onDiagramSelect}
            legend={key()}
            inset={inset}
            title={scenario.title}
          />
        )
      ) : part ? (
        <StructuralDiagram
          key={`links:${part}`}
          kind="cmp"
          project={(sizes) => projectPartLinks(doc, part, status, sizes)}
          signature={`${signature}:${part}`}
          heading={byId(part)!.title}
          selected={shown}
          onSelect={onDiagramSelect}
          onFallback={() => discuss(part, byId(part)!.title)}
          fallback="Discuss in chat"
          legend={key(true)}
          inset={inset}
          title={`${byId(part)!.title}: links`}
        />
      ) : (
        <div className="bpg-empty" role="status">
          <p>No flow yet. Describe an operation in the chat to map it.</p>
        </div>
      )
    ) : notation === "uml-class" ? (
      structural("class", (sizes) => projectRecords(doc, status, sizes), "Records")
    ) : notation === "uml-deployment" ? (
      structural("dep", (sizes) => projectDeployment(doc, status, sizes), "Deployment")
    ) : (
      structural("cmp", (sizes) => projectStructural(doc, status, sizes, layers), "Components")
    );
  return (
    <div className="bpv-plan" data-section={section}>
      <div className="bpv-plan-bar" ref={bar}>
        <div className="bpv-views" role="group" aria-label="Show the plan as">
          {families.map((family) => (
            <div className="bpv-views-family" key={family.name}>
              <span>{family.name}</span>
              <div className="bpv-segments">
                {family.views.map((view) => (
                  <button
                    key={view.label}
                    aria-pressed={
                      view.section === section && view.notation === notation
                    }
                    onClick={() => chooseView(view)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="bpv-field bpv-view-select">
            <span>View</span>
            <select
              aria-label="Show the plan as"
              value={viewKey({ section, notation })}
              onChange={(event) =>
                chooseView(
                  families
                    .flatMap((f) => f.views)
                    .find((v) => viewKey(v) === event.target.value)!,
                )
              }
            >
              {families.map((family) => (
                <optgroup key={family.name} label={family.name}>
                  {family.views.map((view) => (
                    <option key={view.label} value={viewKey(view)}>
                      {family.name} · {view.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <span className="bpv-plan-spacer" />
        {notation === "uml-component" && (
          <div className="bpv-anchor">
            <button
              aria-expanded={layersOpen}
              aria-controls={`${popId}-layers`}
              onClick={() => setLayersOpen((v) => !v)}
            >
              Layers
            </button>
            {layersOpen && (
              <div
                id={`${popId}-layers`}
                className="bpv-pop"
                role="group"
                aria-label="Layers"
              >
                <fieldset>
                  <legend>Show on the diagram</legend>
                  {(
                    [
                      ["traceability", "Requirements, decisions and questions"],
                      ["sources", "Source links"],
                    ] as const
                  ).map(([layer, label]) => (
                    <label className="bpv-toggle" key={layer}>
                      <input
                        type="checkbox"
                        checked={layers[layer]}
                        onChange={() =>
                          onNavigation({
                            layers: { ...layers, [layer]: !layers[layer] },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <p className="bpv-muted">
                  Layers change the picture only, not the plan.
                </p>
              </div>
            )}
          </div>
        )}
        {section === "Structure" && (
          <p className="bpv-plan-hint bpv-muted">
            Select a part to see its flows.
          </p>
        )}
        {section === "Behavior" && notation !== "matrix" && (
          <div className="bpv-flow-bar" role="group" aria-label="Flow">
            {part && (
              <span className="bpv-flow-part">
                <span>
                  <span className="bpv-flow-prefix">
                    {scenarios.length
                      ? `${scenarios.length === 1 ? "The flow" : `${scenarios.length} flows`} through`
                      : "No flow through"}{" "}
                  </span>
                  <strong>{byId(part)!.title}</strong>
                </span>
                <button onClick={() => onNavigation({ part: "", selected: "" })}>
                  All flows
                </button>
              </span>
            )}
            {scenario && (
              <label className="bpv-field">
                <span>Flow</span>
                <select
                  value={scenario.id}
                  onChange={(event) => {
                    setGraphItem(null);
                    onNavigation({ scenario: event.target.value, selected: part });
                  }}
                >
                  {scenarios.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>
      <div className="bpv-plan-canvas" ref={canvas}>
        <section className="bpg" aria-label={`${section} diagram`}>
          <style>{graphStyles}</style>
          {diagram}
        </section>
      </div>
      <aside
        ref={side}
        className="bpv-side"
        data-sheet={showDetail || undefined}
        aria-label={showDetail ? "Selected plan item" : "Plan items"}
      >
        {showDetail ? (
          <SelectedPlanItem
            current={current}
            graphItem={graphItem}
            state={state}
            plan={plan}
            records={records}
            links={links}
            recordLink={ref}
            status={status}
            body={(r) => recordBody(r, { state, ref, openSource })}
            openSource={openSource}
            discuss={discuss}
            onClose={() => select(null)}
          />
        ) : (
          <>
            <PlanItems
              records={records}
              status={status}
              onSelect={(record) =>
                partKinds.includes(record.kind)
                  ? openFlows(record.id)
                  : record.kind === "scenario" && section !== "Behavior"
                    ? open(record.id)
                    : select(null, record.id)
              }
            />
            {history}
          </>
        )}
      </aside>
    </div>
  );
}

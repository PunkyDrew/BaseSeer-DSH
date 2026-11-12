import React, { useEffect } from "react";
import type { PlanningRecord } from "../domain/records.ts";
import { CodeView } from "./code-view.tsx";
import { BuildView } from "./build-view.tsx";
import { ReviewView } from "./review-view.tsx";
import { SourceView } from "./source-view.tsx";
import { PlanGraph } from "./plan-graph.tsx";
import { PlanPage } from "./plan-page.tsx";
import { ChangeHistory } from "./workspace-history.tsx";
import { recordStatus } from "./workspace-records.tsx";
import { useWorkspaceActions } from "./use-workspace-actions.ts";
import { useSourceFocus } from "./use-source-focus.ts";
import type { ProjectChanges } from "./use-project-changes.ts";
import type {
  WorkspaceCall,
  WorkspaceState,
  GraphNavigation,
  ViewName,
} from "./workspace-contract.ts";

/** The page that shows a record's details: scenarios with the flows, everything else with the parts. */
const sectionOf = (record: PlanningRecord): ViewName =>
  record.kind === "scenario" ? "Behavior" : "Structure";

export function WorkspacePanel({
  call,
  sessionId,
  openView,
  state,
  section,
  navigate,
  graphs,
  setGraphs,
  changes,
  active,
  focus,
  refresh,
  error,
}: {
  call: WorkspaceCall;
  sessionId: string;
  openView: (view: string, focus: string) => void;
  state: WorkspaceState & { plan: NonNullable<WorkspaceState["plan"]> };
  section: ViewName;
  navigate: (view: ViewName, id?: string) => void;
  graphs: Record<string, GraphNavigation>;
  setGraphs: React.Dispatch<
    React.SetStateAction<Record<string, GraphNavigation>>
  >;
  changes: ProjectChanges;
  active: boolean;
  focus: { view: ViewName; id: string; serial: number } | null;
  refresh: () => Promise<void>;
  error: string;
}) {
  const plan = state.plan,
    records = plan.document.records;
  const {
    busy,
    notice,
    error: localError,
    undo,
    discuss,
    decide,
  } = useWorkspaceActions(call, sessionId, plan.revision, refresh, () =>
    openView("chat", ""),
  );
  const { sourceRequest, setSourceRequest, openSource, closeSource } =
    useSourceFocus();
  useEffect(() => {
    if (!active) setSourceRequest(null);
  }, [active]);
  const open = (id: string) => {
    const record = records.find((r) => r.id === id);
    if (record) navigate(sectionOf(record), id);
  };
  const status = (r: PlanningRecord) => recordStatus(plan, r);
  const generating =
    !!state.ingestion &&
    ["scanning", "generating", "stopping"].includes(state.ingestion.status);
  // The task graph and the review graph are secondary pictures of the plan,
  // folded under the page they belong to, keeping their camera while the page
  // lives; a selection opens its details in Plan.
  const fold = (view: "Work" | "Review", label: string) => (
    <details className="bpv-diagram-fold">
      <summary>{label}</summary>
      <PlanGraph
        document={plan.document}
        view={view}
        selected=""
        status={status}
        onSelect={(item) => item?.record && open(item.record)}
      />
    </details>
  );
  const messages = (
    <>
      {notice && (
        <p role="status" className="bpv-notice bpv-muted">
          {notice}
        </p>
      )}
      {localError && (
        <p role="alert" className="bpv-error bpv-notice">
          {localError}
        </p>
      )}
      {sourceRequest && (
        <div className="bpv-page">
          <SourceView
            call={call}
            sessionId={sessionId}
            request={sourceRequest}
            onClose={closeSource}
          />
        </div>
      )}
    </>
  );
  if (section === "Structure" || section === "Behavior")
    return (
      <>
        {messages}
        <PlanPage
          section={section}
          state={state}
          navigation={graphs[section] ?? {}}
          onNavigation={(value) =>
            setGraphs((p) => ({ ...p, [section]: { ...p[section], ...value } }))
          }
          focus={focus?.view === section ? focus : null}
          open={open}
          showView={(target, notation, also) => {
            setGraphs((p) => ({
              ...p,
              [target]: { ...p[target], notation, selected: "", ...also },
            }));
            if (target !== section) navigate(target);
          }}
          status={status}
          discuss={discuss}
          openSource={openSource}
          history={
            <details className="bpv-history-fold">
              <summary>
                History
                <span className="bpv-muted">{plan.history.length}</span>
              </summary>
              <ChangeHistory
                plan={plan}
                open={open}
                busy={busy}
                error={error}
                undo={undo}
                decide={decide}
              />
            </details>
          }
        />
      </>
    );
  if (section === "Code")
    return (
      <div className="bpv-page">
        {messages}
        {records.some((r) =>
          ["claim", "evidence", "finding", "analysis"].includes(r.kind),
        ) && fold("Review", "Checks and evidence as a diagram")}
        <ReviewView
          active={active}
          call={call}
          sessionId={sessionId}
          projectMode={!!state.projectMap}
          refreshKey={[plan.revision, changes.version]}
          onOpenSource={openSource}
          onSelect={open}
        />
        <CodeView
          document={plan.document}
          recordRevision={plan.revision}
          onRecord={open}
          active={active}
          generationId={
            state.ingestion && !generating ? state.ingestion.id : "source-map"
          }
          scanLocked={generating}
          projectMode={!!state.projectMap}
          onPlan={() => openView("chat", "")}
          changes={changes}
          call={call}
          sessionId={sessionId}
          navigation={graphs.Code}
          onNavigation={(v) =>
            setGraphs((p) => ({ ...p, Code: { ...p.Code, ...v } }))
          }
        />
      </div>
    );
  return (
    <div className="bpv-page">
      {messages}
      {records.some((r) => r.kind === "task") &&
        fold("Work", "Planned follow-up work as a diagram")}
      <BuildView
        active={active}
        changeVersion={changes.version}
        call={call}
        sessionId={sessionId}
        records={records}
        onSaved={refresh}
      />
    </div>
  );
}

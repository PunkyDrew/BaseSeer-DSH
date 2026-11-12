import React, { useLayoutEffect, useRef, useState } from "react";
import { viewStyles } from "./view-styles.ts";
import { phoneStyles } from "./phone-styles.ts";
import { usePhoneInput } from "./use-phone-input.ts";
import { useProjectChanges } from "./use-project-changes.ts";
import { CodebaseGenerationPanel } from "./codebase-generation.tsx";
import { CodeView } from "./code-view.tsx";
import { WorkspacePanel } from "./workspace-panel.tsx";
import { useWorkspaceData } from "./use-workspace-data.ts";
import { useWorkspaceNavigation } from "./use-workspace-navigation.ts";
import { generationSummary } from "./generation-summary.ts";
import {
  tabOf,
  tabOrder,
  tabSections,
  type TabName,
} from "./workspace-tabs.ts";
import {
  workspaceViews,
  type ViewName,
  type WorkspaceCall,
  type WorkspaceState,
} from "./workspace-contract.ts";

// Hidden pages keep their size and scroll position without receiving input.
function RetainedPanel({
  active,
  name,
  children,
}: {
  active: boolean;
  name: ViewName;
  children: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (element.current) element.current.inert = !active;
  }, [active]);
  return (
    <div
      ref={element}
      className="bpv-panel"
      role="tabpanel"
      id={`bpv-panel-${name}`}
      aria-labelledby={`bpv-tab-${tabOf(name)}`}
      aria-hidden={!active}
      data-active={active}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
export function Workspace({
  call,
  sessionId,
  openView,
}: {
  call: WorkspaceCall;
  sessionId: string;
  openView: (view: string, focus: string) => void;
}) {
  const { state, error, refresh } = useWorkspaceData(call, sessionId);
  const nav = useWorkspaceNavigation(call, sessionId, state?.plan);
  const changes = useProjectChanges(sessionId, state?.plan?.id ?? null);
  const phone = usePhoneInput();
  const [expanded, setExpanded] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const tablist = useRef<HTMLElement>(null);
  const generationActive =
    !!state?.ingestion &&
    ["scanning", "generating", "stopping"].includes(state.ingestion.status);
  const currentTab = tabOf(nav.section);
  // Each page reopens the section last used inside it (Plan: parts or flows).
  const lastSection = useRef<Partial<Record<TabName, ViewName>>>({});
  lastSection.current[currentTab] = nav.section;
  const openTab = (tab: TabName) =>
    nav.select(lastSection.current[tab] ?? tabSections[tab][0]);
  return (
    <div
      className="bpv bpv-workspace"
      data-testid="session-build-plan"
      data-conversation-composer-overlay=""
      data-phone-input={phone || undefined}
      data-phone-expanded={(phone && expanded) || undefined}
    >
      <style>
        {viewStyles}
        {phoneStyles}
      </style>
      <header className="bpv-top">
        <div className="bpv-title">
          <h1>{state?.plan?.title ?? "BaseSeer"}</h1>
          <span className="bpv-muted">
            {state?.workspace.title ?? "This session’s project"}
            {state?.enabled ? "" : " · View only"}
          </span>
        </div>
        <nav
          ref={tablist}
          className="bpv-tabs"
          aria-label="BaseSeer pages"
          role="tablist"
          onKeyDown={(event) => {
            const index = tabOrder.indexOf(currentTab);
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % tabOrder.length
                : event.key === "ArrowLeft"
                  ? (index + tabOrder.length - 1) % tabOrder.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabOrder.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            openTab(tabOrder[next]);
            tablist.current?.querySelectorAll("button")[next]?.focus();
          }}
        >
          {tabOrder.map((name) => (
            <button
              key={name}
              id={`bpv-tab-${name}`}
              role="tab"
              aria-selected={currentTab === name}
              aria-controls={`bpv-panel-${tabSections[name].find((s) => s === nav.section) ?? tabSections[name][0]}`}
              tabIndex={currentTab === name ? 0 : -1}
              onClick={() => openTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        {phone ? (
          <button
            className="bpv-expand"
            aria-pressed={expanded}
            aria-label={expanded ? "Exit expanded plan" : "Expand plan"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Exit" : "Expand"}
          </button>
        ) : (
          <button className="bpv-chat" onClick={() => openView("chat", "")}>
            Chat
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="bpv-error bpv-notice">
          {error}
          {state &&
            " Showing the last loaded plan. Changes are unavailable until reconnection."}
        </p>
      )}
      {nav.error && (
        <p role="status" className="bpv-notice bpv-muted">
          {nav.error}
        </p>
      )}
      {state?.ingestion &&
        !coverageOpen &&
        !generationActive &&
        (currentTab === "Plan" || currentTab === "Code") && (
          <p className="bpv-muted bpv-notice">
            {generationSummary(state.ingestion)}{" "}
            <button
              className="bpv-link"
              onClick={() => setCoverageOpen(true)}
            >
              Review coverage and gaps
            </button>
          </p>
        )}
      {!state && !error && (
        <p role="status" className="bpv-loading">
          Loading this session’s plan…
        </p>
      )}
      {state?.ingestion && (coverageOpen || generationActive) && (
        <div className="bpv-notice">
          <CodebaseGenerationPanel
            call={call}
            sessionId={sessionId}
            state={state}
            onChanged={refresh}
            onCode={() => nav.select("Code")}
            onPlanning={() => nav.select("Structure")}
            onSection={(name) => nav.select(name as ViewName)}
            onChat={() => openView("chat", "")}
          />
        </div>
      )}
      {state && nav.loaded && (
        <div className="bpv-panels">
          {workspaceViews
            .filter((name) => nav.visited.has(name))
            .map((name) => (
              <RetainedPanel
                key={`${state.plan?.id ?? "empty"}:${name}`}
                name={name}
                active={nav.section === name}
              >
                {state.plan ? (
                  <WorkspacePanel
                    call={call}
                    sessionId={sessionId}
                    state={
                      state as WorkspaceState & {
                        plan: NonNullable<WorkspaceState["plan"]>;
                      }
                    }
                    section={name}
                    active={nav.section === name}
                    navigate={nav.select}
                    graphs={nav.graphs}
                    setGraphs={nav.setGraphs}
                    focus={nav.focus}
                    changes={changes}
                    openView={openView}
                    refresh={refresh}
                    error={error}
                  />
                ) : name === "Code" ? (
                  <div className="bpv-page">
                    <CodeView
                      call={call}
                      sessionId={sessionId}
                      active={nav.section === name}
                      changes={changes}
                      scanLocked={generationActive}
                      generationId={state.ingestion?.id ?? "source-map"}
                      navigation={nav.graphs.Code}
                      onNavigation={(value) =>
                        nav.setGraphs((previous) => ({
                          ...previous,
                          Code: { ...previous.Code, ...value },
                        }))
                      }
                      onPlan={() => openView("chat", "")}
                    />
                  </div>
                ) : (
                  <section className="bpv-empty">
                    <h2>No saved plan yet</h2>
                    <p>
                      Saved {tabOf(name).toLowerCase()} records appear here when
                      available. Choose Planning in the chat mode preset picker
                      to maintain the project plan.
                    </p>
                  </section>
                )}
              </RetainedPanel>
            ))}
        </div>
      )}
    </div>
  );
}

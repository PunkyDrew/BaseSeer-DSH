import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Document } from "../domain/records.ts";
import { componentMap } from "../contracts/component-map.ts";
import { ComponentOverview } from "./component-overview.tsx";
import { CodeGraph } from "./code-graph.tsx";
import {
  groupConnections,
  connectionDetailGroups,
} from "./connection-groups.ts";
import { SourceFileDetail } from "./code-file-detail.tsx";
import {
  SourcePreview,
  CoverageDetails,
  ProjectBaseline,
} from "./code-source-panels.tsx";
import { noChanges, type ProjectChanges } from "./use-project-changes.ts";
import {
  sourceConnections,
  connectionNeighborhood,
} from "../contracts/source-connections.ts";

import { useCodeInspection } from "./use-code-inspection.ts";
import type { GraphNavigation } from "./workspace-contract.ts";

export function CodeView({
  active = true,
  generationId = "",
  call,
  sessionId,
  navigation,
  onNavigation,
  changes = noChanges,
  projectMode = false,
  scanLocked = false,
  onPlan,
  document: recordsDocument = { records: [], links: [] },
  recordRevision = 0,
  onRecord,
}: {
  active?: boolean;
  generationId?: string;
  call: (op: string, payload?: unknown) => Promise<any>;
  sessionId: string;
  navigation?: GraphNavigation;
  onNavigation?: (value: GraphNavigation) => void;
  changes?: ProjectChanges;
  projectMode?: boolean;
  scanLocked?: boolean;
  onPlan?: () => void;
  document?: Document;
  recordRevision?: number;
  onRecord?: (id: string) => void;
}) {
  const [selected, setSelected] = useState(navigation?.selected ?? ""),
    [folder, setFolder] = useState(navigation?.folder ?? ""),
    [dependencies, setDependencies] = useState(
      navigation?.dependencies ?? true,
    );
  useEffect(() => {
    onNavigation?.({ selected, folder, dependencies });
  }, [selected, folder, dependencies]);
  const [source, setSource] = useState<{
    path: string;
    content: string;
    sha256: string;
  } | null>(null);
  const [line, setLine] = useState(1);
  const [codePositions, setCodePositions] = useState<
    Record<string, GraphNavigation>
  >({ files: navigation ?? {} });
  const [mapView, setMapView] = useState(projectMode ? "components" : "files"),
    [connectionId, setConnectionId] = useState("");
  const [scope, setScope] = useState(""),
    [search, setSearch] = useState(""),
    [filePage, setFilePage] = useState(0),
    [omissionPage, setOmissionPage] = useState(0);

  const sourceRequest = useRef(0);
  const {
    snapshot,
    mapState,
    progress,
    error,
    setError,
    busy,
    fresh,
    setFresh,
    refresh,
    query,
    scanId,
  } = useCodeInspection({
    recordRevision,
    call,
    sessionId,
    projectMode,
    active,
    generationId,
    changeVersion: changes.version,
    scope,
    onScope: setScope,
    onSnapshot: (next) => {
      ++sourceRequest.current;
      setSource(null);
      setSelected((prior) =>
        next.files.some((f) => f.path === prior) ? prior : "",
      );
      setFolder((prior) =>
        next.files.some((f) => f.path.startsWith(prior + "/")) ? prior : "",
      );
    },
  });
  useEffect(() => {
    if (!active) ++sourceRequest.current;
    return () => {
      ++sourceRequest.current;
    };
  }, [active]);
  const connected = projectMode && mapView === "connections";
  const componentMode = projectMode && mapView === "components";
  const components = useMemo(
    () =>
      snapshot
        ? componentMap(recordsDocument, snapshot, mapState?.explanations ?? [])
        : null,
    [recordsDocument, snapshot, mapState],
  );
  const connections = useMemo(
    () =>
      snapshot ? sourceConnections(snapshot, mapState?.explanations ?? []) : [],
    [snapshot, mapState],
  );
  const neighborhood = useMemo(
    () =>
      snapshot ? connectionNeighborhood(snapshot, connections, selected) : null,
    [snapshot, connections, selected],
  );
  const focused = connected ? (neighborhood?.focus ?? "") : selected;
  const file = snapshot?.files.find((f) => f.path === focused);
  const connectionGroups = useMemo(
    () => groupConnections(neighborhood?.connections ?? []),
    [neighborhood],
  );
  const detailGroups = useMemo(
    () => (neighborhood ? connectionDetailGroups(neighborhood) : []),
    [neighborhood],
  );
  useEffect(() => setConnectionId(""), [snapshot?.digest, selected, mapView]);
  const visibleFiles =
    snapshot?.files.filter((f) => !folder || f.path.startsWith(folder + "/")) ??
    [];
  const matchingFiles = visibleFiles.filter((f) =>
    f.path.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => setFilePage(0), [folder, search, snapshot?.digest]);
  useEffect(() => setOmissionPage(0), [snapshot?.digest]);
  const folders = [
    ...new Set(
      visibleFiles
        .map((f) => {
          const rest = folder ? f.path.slice(folder.length + 1) : f.path;
          return rest.includes("/")
            ? [folder, rest.split("/")[0]].filter(Boolean).join("/")
            : "";
        })
        .filter(Boolean),
    ),
  ];
  const chooseFolder = (next: string) => {
    setMapView("files");
    ++sourceRequest.current;
    setFolder(next);
    setSelected("");
    setSource(null);
  };
  const chooseFile = (next: string) => {
    ++sourceRequest.current;
    setSelected(next);
    setSource(null);
    setLine(1);
  };
  const showSource = async (at = 1, name = focused) => {
    const token = ++sourceRequest.current;
    setError("");
    setLine(at);
    try {
      const value = await query({
        action: "source",
        digest: snapshot?.digest,
        path: name,
      });
      if (sourceRequest.current === token) {
        setSource(value);
        setFresh("current");
      }
    } catch (e) {
      if (sourceRequest.current === token) {
        setError(String(e));
        setSource(null);
        setFresh(String(e).includes("STALE") ? "stale" : "unknown");
      }
    }
  };
  useEffect(() => {
    if (!active) return;
    document
      .getElementById(`code-line-${line}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [source, line]);
  return (
    <section className="bpc" aria-label="Source inspection">
      <style>{codeStyles}</style>
      <div className="bpc-status">
        <div>
          <h2>Inspected source</h2>
          <p className="bpv-muted" role="status">
            {!snapshot
              ? busy
                ? "Inspecting workspace…"
                : "Inspection failed. Use Re-read files to try again."
              : fresh === "current"
                ? `Checked ${new Date(snapshot.checkedAt).toLocaleTimeString()} · ${snapshot.files.length} files read`
                : fresh === "checking"
                  ? "Checking source freshness… The saved inspection remains visible."
                  : fresh === "stale"
                    ? "Source changed — showing the previous inspection. Refresh to inspect changes."
                    : "Freshness unknown — this inspection is not confirmed current."}
          </p>
        </div>
        {projectMode && (
          <label className="bpv-setting-field">
            Folder to read
            <input
              aria-label="Folder to read"
              value={scope}
              disabled={busy || scanLocked}
              placeholder="Whole project"
              onChange={(e) => setScope(e.target.value)}
            />
          </label>
        )}
        <button onClick={() => void refresh()} disabled={busy || scanLocked}>
          {busy ? "Reading files…" : "Re-read files"}
        </button>
        {projectMode && busy && (
          <button
            disabled={!scanId.current || scanLocked}
            onClick={() =>
              void query({ action: "cancel", id: scanId.current }).catch((e) =>
                setError(String(e)),
              )
            }
          >
            Cancel scan
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="bpv-error">
          {error}
        </p>
      )}
      {changes.error && (
        <p role="status" className="bpv-muted">
          {changes.error}
        </p>
      )}
      <p className="bpv-muted">Re-reading uses no AI and changes no files.</p>
      {progress && (
        <p role="status">
          {progress.phase === "analyzing"
            ? "Analyzing languages"
            : "Reading source"}{" "}
          · {progress.files} files · {progress.visited} entries
        </p>
      )}
      {snapshot && (
        <>
          {projectMode && (
            <div
              className="bpc-controls"
              role="group"
              aria-label="Code map view"
            >
              <button
                aria-pressed={componentMode}
                onClick={() => setMapView("components")}
              >
                {componentMode ? "Selected: Components" : "Components"}
              </button>
              <button
                aria-pressed={connected}
                onClick={() => setMapView("connections")}
              >
                {connected ? "Selected: File connections" : "File connections"}
              </button>
              <button
                aria-pressed={!componentMode && !connected}
                onClick={() => setMapView("files")}
              >
                {!componentMode && !connected
                  ? "Selected: Files and folders"
                  : "Files and folders"}
              </button>
            </div>
          )}
          {components && (
            <div hidden={!componentMode}>
              {
                <ComponentOverview
                  map={components}
                  sourceCurrent={fresh === "current"}
                  onRecord={onRecord}
                  onFile={(path) => {
                    setMapView("connections");
                    chooseFile(path);
                  }}
                  onSource={(line, path) => {
                    setMapView("connections");
                    chooseFile(path);
                    void showSource(line, path);
                  }}
                />
              }
            </div>
          )}
          {!componentMode && (
            <>
              {connected && neighborhood && (
                <section aria-label="Connection overview">
                  <h3>File references and explanations</h3>
                  <p>
                    Showing{" "}
                    <strong>{neighborhood.focus || "no inspected file"}</strong>{" "}
                    with its incoming and outgoing relationships across all
                    scanned folders. Select a file to follow its connections.
                  </p>
                  <p>
                    {neighborhood.incoming.length} incoming ·{" "}
                    {neighborhood.outgoing.length} outgoing ·{" "}
                    {neighborhood.unresolved.length} imports without an
                    inspected target · {neighborhood.historical.length}{" "}
                    historical inferred connections.
                  </p>
                  {!neighborhood.connections.length && (
                    <p>
                      No connection has been established here. Source-only
                      languages and dynamic dependencies need cited
                      interpretation in the project chat; an isolated box does
                      not prove an independent module.
                    </p>
                  )}
                  {(neighborhood.omitted > 0 ||
                    neighborhood.omittedConnections > 0) && (
                    <p role="status">
                      This view omits {neighborhood.omitted} neighboring files
                      and {neighborhood.omittedConnections} links to keep the
                      graph readable. Incoming and outgoing details remain
                      listed below.
                    </p>
                  )}
                </section>
              )}
              <div className="bpc-controls">
                <label className="bpv-toggle">
                  <input
                    type="checkbox"
                    checked={dependencies}
                    onChange={() => setDependencies(!dependencies)}
                  />
                  Show dependency links
                </label>
                <button aria-pressed={!folder} onClick={() => chooseFolder("")}>
                  All folders
                </button>
                {folder && (
                  <>
                    <button
                      onClick={() =>
                        chooseFolder(folder.split("/").slice(0, -1).join("/"))
                      }
                    >
                      Up one folder
                    </button>
                    <span className="bpv-muted">{folder}/</span>
                  </>
                )}
                {folders.map((name) => (
                  <button
                    key={name}
                    aria-pressed={folder === name}
                    onClick={() => chooseFolder(name)}
                  >
                    {name.slice(folder ? folder.length + 1 : 0)}/
                  </button>
                ))}
              </div>
              {visibleFiles.length > 0 && (
                <details className="bpc-files" key={folder}>
                  <summary>Browse {visibleFiles.length} files</summary>
                  <label>
                    Find a file{" "}
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <ul>
                    {matchingFiles
                      .slice(filePage * 100, (filePage + 1) * 100)
                      .map((f) => (
                        <li key={f.path}>
                          <button
                            className="bpv-link"
                            onClick={(event) => {
                              chooseFile(f.path);
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                            }}
                          >
                            {f.path}
                          </button>
                        </li>
                      ))}
                  </ul>
                  <p>
                    {matchingFiles.length} matching files. Page {filePage + 1}{" "}
                    of {Math.max(1, Math.ceil(matchingFiles.length / 100))}.
                  </p>
                  <button
                    disabled={!filePage}
                    onClick={() => setFilePage((p) => p - 1)}
                  >
                    Previous files
                  </button>{" "}
                  <button
                    disabled={(filePage + 1) * 100 >= matchingFiles.length}
                    onClick={() => setFilePage((p) => p + 1)}
                  >
                    Next files
                  </button>
                </details>
              )}
              <p className="bpv-muted bpc-coverage">
                Observed source ·{" "}
                {snapshot.analysis
                  ? "Language capabilities below"
                  : "Earlier syntax coverage"}{" "}
                · No behavior verification.{" "}
                {snapshot.partial
                  ? "Some source files could not be read. "
                  : ""}
                {snapshot.omissions.length} exclusions.{" "}
                <a href="#code-coverage">Inspect coverage and limits</a>
              </p>
              {snapshot.files.length === 0 ? (
                <div className="bpg-empty">
                  <h3>No readable source files found</h3>
                  <p>
                    Check the selected folder and exclusions below. No readable
                    source in this scan does not establish that the project is
                    empty. Source transfer or access may still be incomplete.
                  </p>
                </div>
              ) : (
                <div className="bpc-layout" data-detail={file ? "" : undefined}>
                  <CodeGraph
                    key={connected ? "connections" : "files"}
                    grouped={projectMode && !connected}
                    onFolder={chooseFolder}
                    snapshot={
                      connected && neighborhood
                        ? { ...snapshot, files: neighborhood.files }
                        : snapshot
                    }
                    selected={focused}
                    folder={connected ? "" : folder}
                    relationshipConnections={
                      connected ? connectionGroups : undefined
                    }
                    onConnection={(c) => setConnectionId(c.id)}
                    dependencies={dependencies}
                    onSelect={chooseFile}
                    navigation={codePositions[mapView]}
                    onNavigation={(value) => {
                      setCodePositions((p) => ({
                        ...p,
                        [mapView]: { ...p[mapView], ...value },
                      }));
                      if (!connected) onNavigation?.(value);
                    }}
                  />
                  {file && (
                    <SourceFileDetail
                      file={file}
                      projectMode={projectMode}
                      neighborhood={neighborhood}
                      detailGroups={detailGroups}
                      connectionId={connectionId}
                      focused={focused}
                      setConnectionId={setConnectionId}
                      fresh={fresh}
                      showSource={showSource}
                      onClose={() => {
                        ++sourceRequest.current;
                        if (connected) setMapView("files");
                        setSelected("");
                        setSource(null);
                      }}
                    />
                  )}
                </div>
              )}
              {source && (
                <SourcePreview source={source} fresh={fresh} line={line} />
              )}
            </>
          )}
          <CoverageDetails
            snapshot={snapshot}
            omissionPage={omissionPage}
            setOmissionPage={setOmissionPage}
          />
        </>
      )}
      {projectMode && (
        <ProjectBaseline
          mapState={mapState}
          progress={progress}
          fresh={fresh}
          chooseFile={chooseFile}
          showSource={showSource}
          onPlan={onPlan}
        />
      )}
    </section>
  );
}
const codeStyles = `
.bpc-status { flex-wrap:wrap; display:flex; justify-content:space-between; align-items:flex-start; gap:12px 18px; }
.bpc-status h2 { margin:0; } .bpc-status p { margin:2px 0 8px; }
.bpc-project { margin:16px 0 24px; max-width:80ch; } .bpc-project label,.bpc-files label { display:flex; align-items:center; flex-wrap:wrap; gap:8px; } .bpc-project article { margin:18px 0; } .bpc-project details { margin:12px 0; }
.bpc-controls { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin:8px 0; }
.bpc-files summary { margin-top:6px; font-size:13px; }
.bpc-files ul { max-height:180px; overflow:auto; margin:6px 0; }
.bpc-controls button { font-size:12px; padding:4px 10px; min-height:32px; }
.bpc-coverage { margin:6px 0 0!important; max-width:none!important; }
.bpc a { color:var(--blue); text-underline-offset:3px; }
.bpc-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:20px; margin:12px 0; }
.bpc-layout[data-detail] { grid-template-columns:minmax(0,1fr) minmax(280px,34%); }
.bpc-layout>.bpg { height:clamp(320px,60cqh,720px); }
.bpc-layout>.bpv-detail { max-height:clamp(320px,60cqh,720px); overflow:auto; padding:0 0 0 16px; border-left:1px solid var(--ink); }
.bpc-node[data-coverage=unsupported] { border-style:dashed; }
.bpc-node[data-coverage=parse-error] { border-color:var(--red); }
.bpc-source { margin-top:22px; } .bpc-source pre { max-height:380px; overflow:auto; white-space:pre; padding:12px; background:var(--paper); border:1px solid var(--ink); font:13px/1.7 var(--mono); }
.bpc-source pre>span { display:block; min-width:max-content; } .bpc-source pre>span[data-selected=true] { background:var(--blue-wash); }
.bpc-line-number { display:inline-block; width:48px; color:var(--ink-3); user-select:none; font-variant-numeric:tabular-nums; }
#code-coverage { margin-top:18px; }
@container workspace (max-width: 899px) { .bpc-layout[data-detail] { grid-template-columns:minmax(0,1fr); } .bpc-layout>.bpv-detail { max-height:none; padding:12px 0 0; border-left:0; border-top:1px solid var(--ink); } }
`;

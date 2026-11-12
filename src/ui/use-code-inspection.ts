import { useEffect, useRef, useState } from "react";
import type { CodeSnapshot } from "../contracts/code.ts";
import type { WorkspaceCall } from "./workspace-contract.ts";
import type { MapStatus, ScanProgress } from "../contracts/project-map.ts";

export function useCodeInspection({
  call,
  sessionId,
  projectMode,
  active,
  generationId,
  recordRevision = 0,
  changeVersion,
  scope,
  onScope,
  onSnapshot,
}: {
  call: WorkspaceCall;
  sessionId: string;
  projectMode: boolean;
  active: boolean;
  generationId: string;
  recordRevision?: number;
  changeVersion: number;
  scope: string;
  onScope: (scope: string) => void;
  onSnapshot: (snapshot: CodeSnapshot) => void;
}) {
  const [snapshot, setSnapshot] = useState<CodeSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<
    "checking" | "current" | "stale" | "unknown"
  >("checking");
  const [mapState, setMapState] = useState<MapStatus | null>(null),
    [progress, setProgress] = useState<ScanProgress>();
  const scanId = useRef(""),
    epoch = useRef(0),
    freshEpoch = useRef(0);
  const latest = useRef({ scope, onSnapshot, onScope, snapshot, active });
  latest.current = { scope, onSnapshot, onScope, snapshot, active };
  const query = (command: unknown) =>
    call(projectMode ? "session-map" : "session-code", {
      session: sessionId,
      command,
    });
  const refresh = async (silent = false, restore = false) => {
    const token = ++epoch.current;
    freshEpoch.current++;
    setBusy(true);
    setError("");
    setFresh("checking");
    try {
      let next: CodeSnapshot;
      if (projectMode) {
        let status: MapStatus = await query({ action: "status" });
        if (token !== epoch.current) return;
        if (
          (!restore || !status.snapshot) &&
          status.job?.status !== "running"
        ) {
          await query({ action: "start", scope: latest.current.scope });
          if (token !== epoch.current) return;
          status = await query({ action: "status" });
        }
        while (status.job?.status === "running") {
          if (token !== epoch.current) return;
          scanId.current = status.job.id;
          setProgress(status.job.progress);
          await new Promise((r) => setTimeout(r, 400));
          if (token !== epoch.current) return;
          status = await query({ action: "status" });
        }
        if (token !== epoch.current) return;
        scanId.current = "";
        setProgress(undefined);
        setMapState(status);
        if (status.job?.status === "error") throw Error(status.job.error);
        if (status.job?.status === "cancelled")
          throw Error("Scan cancelled. The last completed scan is retained.");
        if (!status.snapshot)
          throw Error("No scan is available. Use Re-read files to try again.");
        next = status.snapshot;
        if (restore) latest.current.onScope(status.snapshot.scope);
      } else next = await query({ action: "inspect" });
      if (token !== epoch.current) return;
      if (
        !next ||
        !Array.isArray(next.files) ||
        typeof next.digest !== "string"
      )
        throw Error("The source inspection response could not be read.");
      if (next.digest !== latest.current.snapshot?.digest) {
        setSnapshot(next);
        latest.current.onSnapshot(next);
      }
      setFresh(projectMode && restore ? "unknown" : "current");
    } catch (e) {
      if (token === epoch.current) {
        setError(String(e));
        setFresh("unknown");
      }
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    // Code inspection is demand-driven: opening an empty Normal workspace
    // must not start scans until its Code view is active.
    if (!active) return;
    void refresh(false, true);
    return () => {
      epoch.current++;
      freshEpoch.current++;
    };
  }, [active, sessionId, projectMode, generationId, projectMode ? recordRevision : 0]);
  useEffect(() => {
    if (active && changeVersion && !projectMode) void refresh(true);
  }, [changeVersion, projectMode, active]);
  useEffect(() => {
    if (!active || !snapshot || busy) return;
    let live = true,
      pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      const token = ++freshEpoch.current;
      setFresh("checking");
      try {
        const result = await query({
          action: "freshness",
          digest: snapshot.digest,
        });
        if (live && token === freshEpoch.current)
          setFresh(result.current ? "current" : "stale");
      } catch {
        if (live && token === freshEpoch.current) setFresh("unknown");
      } finally {
        pending = false;
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => {
      live = false;
      freshEpoch.current++;
      window.removeEventListener("focus", check);
    };
  }, [active, snapshot?.digest, busy, sessionId, projectMode]);
  return {
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
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  workspaceResult,
  type WorkspaceCall,
  type WorkspaceState,
} from "./workspace-contract.ts";

// One serial refresh owner per session. An explicit refresh invalidates older
// reads (including reads started before an action), and queues one fresh read.
export function useWorkspaceData(call: WorkspaceCall, session: string) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState("");
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setState(null);
    setError("");
    let live = true,
      pending: Promise<void> | null = null,
      epoch = 0,
      again = false;
    const read = (): Promise<void> => {
      if (!live) return Promise.resolve();
      if (pending) {
        again = true;
        return pending;
      }
      const token = epoch;
      pending = (async () => {
        try {
          const next = workspaceResult(await call("session-plan", { session }));
          if (live && token === epoch) {
            setState((prior) =>
              JSON.stringify(prior) === JSON.stringify(next) ? prior : next,
            );
            setError("");
          }
        } catch (e) {
          if (live && token === epoch) setError(String(e));
        } finally {
          pending = null;
          if (again && live) {
            again = false;
            await read();
          }
        }
      })();
      return pending;
    };
    refresh.current = () => {
      epoch++;
      return read();
    };
    void read();
    const tick = () => {
      if (!document.hidden) void read();
    };
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      live = false;
      epoch++;
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [call, session]);
  return {
    state,
    error,
    setError,
    refresh: useCallback(() => refresh.current(), []),
  };
}

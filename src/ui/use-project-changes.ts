import { useEffect, useState } from "react";

/** A count that rises each time the project changes, and the stream's health. */
export interface ProjectChanges {
  version: number;
  connected: boolean;
  error: string;
}
export const noChanges: ProjectChanges = {
  version: 0,
  connected: false,
  error: "",
};

/**
 * Listens to the project's change stream. The stream only says that the
 * plan, code map or build changed; views read their own state again when
 * the version rises. The stream closes while the page is hidden, and coming
 * back to the window counts as a change, so views catch up on what they
 * missed.
 */
export function useProjectChanges(
  sessionId: string,
  scope: string | null = sessionId,
): ProjectChanges {
  const [state, setState] = useState<ProjectChanges>(noChanges);
  useEffect(() => {
    if (!scope) {
      setState(noChanges);
      return;
    }
    let stream: EventSource | undefined;
    let live = true;
    const changed = () => {
      if (!live || document.hidden || stream?.readyState !== EventSource.OPEN)
        return;
      setState((prior) => ({
        version: prior.version + 1,
        connected: true,
        error: "",
      }));
    };
    const connect = () => {
      stream?.close();
      stream = undefined;
      setState((prior) => ({ ...prior, connected: false }));
      if (document.hidden || !live) return;
      stream = new EventSource(
        `/api/build-plan/events?session=${encodeURIComponent(sessionId)}`,
      );
      stream.addEventListener("changed", changed);
      stream.onerror = () =>
        setState((prior) => ({
          ...prior,
          connected: false,
          error:
            "Live updates disconnected. Showing the last state; reconnecting…",
        }));
    };
    setState(noChanges);
    connect();
    document.addEventListener("visibilitychange", connect);
    window.addEventListener("focus", changed);
    return () => {
      live = false;
      stream?.close();
      document.removeEventListener("visibilitychange", connect);
      window.removeEventListener("focus", changed);
    };
  }, [sessionId, scope]);
  return state;
}

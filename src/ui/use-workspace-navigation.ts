import { useEffect, useRef, useState } from "react";
import { navigation } from "../domain/navigation.ts";
import { visibleSection } from "./view-meaning.ts";
import type {
  GraphNavigation,
  ViewName,
  WorkspaceCall,
  WorkspacePlan,
} from "./workspace-contract.ts";

export function useWorkspaceNavigation(
  call: WorkspaceCall,
  session: string,
  plan: WorkspacePlan | null | undefined,
) {
  const [section, setSection] = useState<ViewName>("Structure");
  const [graphs, setGraphs] = useState<Record<string, GraphNavigation>>({});
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const [visited, setVisited] = useState<Set<ViewName>>(new Set());
  const choice = useRef(0),
    writeVersion = useRef(0);
  const writes = useRef(Promise.resolve());
  const [focus, setFocus] = useState<{
    view: ViewName;
    id: string;
    serial: number;
  } | null>(null);
  const select = (view: ViewName, id?: string) => {
    choice.current++;
    setVisited((prior) => new Set([...prior, view]));
    setSection(view);
    if (id !== undefined)
      setFocus((prior) => ({ view, id, serial: (prior?.serial ?? 0) + 1 }));
  };
  useEffect(() => {
    let live = true;
    const initialChoice = choice.current;
    setLoaded(false);
    void call("session-navigation", { session })
      .then((value) => {
        if (!live) return;
        const v = navigation(value),
          name = visibleSection(v.section) as ViewName;
        setGraphs({
          ...v.graphs,
          [name]: {
            ...v.graphs[name],
            selected: v.graphs[name]?.selected ?? v.selected,
          },
        });
        if (choice.current === initialChoice) select(name);
      })
      .catch(() => {
        if (live) {
          if (choice.current === initialChoice) select("Structure");
          setError(
            "Saved view position could not be loaded. Your plan is still available.",
          );
        }
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [call, session]);
  useEffect(() => {
    if (!loaded || !plan) return;
    let live = true;
    const version = ++writeVersion.current;
    const timer = setTimeout(() => {
      writes.current = writes.current
        .then(async () => {
          if (!live || version !== writeVersion.current) return;
          await call("session-navigation", {
            session,
            command: {
              section,
              selected: graphs[section]?.selected ?? "",
              graphs,
            },
          });
        })
        .catch(() => {
          if (live)
            setError(
              "View position could not be saved. The shared plan is unchanged.",
            );
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [call, session, section, graphs, loaded, plan?.id]);
  return {
    section,
    select,
    graphs,
    setGraphs,
    loaded,
    visited,
    focus,
    error,
  };
}

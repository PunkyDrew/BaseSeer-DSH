import { useEffect, useRef, useState } from "react";
import type { WorkspaceCall } from "./workspace-contract.ts";

// Actions own their pending/error state and invalidate pre-action plan reads.
// Server revision, authority and command validation remain authoritative.
export function useWorkspaceActions(
  call: WorkspaceCall,
  session: string,
  revision: number,
  refresh: () => Promise<void>,
  openChat: () => void,
) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const mounted = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [session]);
  const act = async (
    op: string,
    payload: unknown,
    message: string,
    chat = false,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await call(op, payload);
      if (!mounted.current) return;
      await refresh();
      if (!mounted.current) return;
      setNotice(message);
      if (chat) openChat();
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    busy,
    notice,
    error,
    undo: () =>
      act(
        "session-undo",
        { session, key: crypto.randomUUID(), command: { expected: revision } },
        "Draft change undone. The shared plan has updated.",
      ),
    discuss: (id: string, title: string) =>
      act(
        "session-context",
        { session, command: { id } },
        `Chat context: ${title}. Ask your question in the composer.`,
        true,
      ),
    decide: (
      op: "accept-proposal" | "reject-proposal",
      id: string,
      title: string,
    ) =>
      act(
        "session-design",
        {
          session,
          command: {
            op,
            proposal: id,
            expected: revision,
            key: crypto.randomUUID(),
            reason: `${op === "accept-proposal" ? "Accept" : "Abandon"} reviewed proposal: ${title}`,
          },
        },
        "Decision saved. Existing checks still apply only to the original plan and files.",
      ),
  };
}

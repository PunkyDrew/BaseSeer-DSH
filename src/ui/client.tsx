import React, { useEffect, useState } from "react";
import { Workspace } from "./workspace.tsx";
import { ProviderPricing } from "./provider-pricing.tsx";
import { sheetFonts } from "./sheet-fonts.ts";
export const inject = ["slots", "connection"];
function PlanContext({
  call,
  sessionId,
}: {
  call: (op: string, payload: any) => Promise<any>;
  sessionId: string;
}) {
  const [selection, setSelection] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () =>
      call("session-context", { session: sessionId })
        .then((v) => {
          if (live) setSelection(v);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId]);
  if (!selection) return null;
  return (
    <div className="bpv-chat-context" data-dsh-composer-detail role="status">
      <span>
        BaseSeer context: <strong>{selection.title}</strong>
        {selection.missing
          ? " · removed from current plan"
          : ` · v${selection.version}`}
      </span>
      <button
        onClick={() =>
          void call("session-context", {
            session: sessionId,
            command: { clear: true },
          })
            .then(() => setSelection(null))
            .catch((e) => setError(String(e)))
        }
      >
        Clear plan context
      </button>
      {error && <span role="alert">{error}</span>}
      <style>{`.bpv-chat-context{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;color:var(--text-primary);font-size:13px}.bpv-chat-context button{font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.bpv-chat-context button:focus-visible{outline:2px solid currentColor;outline-offset:3px}`}</style>
    </div>
  );
}
export function apply(ctx: any) {
  const call = async (op: string, payload: unknown = {}) => {
    const r = await (
      await fetch("/api/build-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, payload }),
      })
    ).json();
    if (!r.ok)
      throw Object.assign(
        new Error(`${r.error.code}: ${r.error.message}`),
        r.error,
      );
    return r.value;
  };
  // DSH owns session selection and the resident Chat composer. No global navigation entry.
  ctx.slots.inject("settings.models.provider-card", () => {
    for (const ns of ["llm-deepseek", "llm-pi-ai"])
      ctx.slots.register(
        { name: "settings.models.provider-card", key: ns },
        (props: any) => (
          <ProviderPricing provider={props.provider} call={call} />
        ),
      );
  });
  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      { name: "conversation.input.dock", id: "build-plan-context", order: 20 },
      (props: any) => (
        <PlanContext
          key={props.sessionId}
          sessionId={props.sessionId}
          call={call}
        />
      ),
    ),
  );
  ctx.slots.inject("conversation.view", () =>
    ctx.slots.register(
      {
        name: "conversation.view",
        id: "baseseer",
        order: 20,
        label: "BaseSeer",
      },
      (props: any) => (
        <>
          <style>{sheetFonts}</style>
          <Workspace
            key={props.sessionId}
            sessionId={props.sessionId}
            call={call}
            openView={props.openView}
          />
        </>
      ),
    ),
  );
}

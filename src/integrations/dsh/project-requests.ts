import { PlanError, text } from "../../domain/plan.ts";

import type { RequestPayload, RequestServices } from "./request-services.ts";

export function projectRequests(services: RequestServices) {
  const { records, bound } = services;

  return async (endpoint: string, q: RequestPayload): Promise<unknown> => {
    switch (endpoint) {
      case "records": {
        const actor = q.plan
          ? {
              id: "owner",
              role: "owner" as const,
              plan: text(q.plan, "plan", 100),
              workspace: "",
              source: "",
            }
          : bound(q.workspace).actor;
        return records.execute(actor, q.command ?? { op: "read" });
      }
      case "source-context":
        return bound(q.workspace).source;

      default:
        throw new PlanError("DENIED", "Unknown owner operation");
    }
  };
}

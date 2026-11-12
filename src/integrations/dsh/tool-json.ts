import { PlanError } from "../../domain/plan.ts";

// Transport-only normalization. Never rewrite the saved domain object or its
// fingerprint. Undefined object properties are omitted; an absent result is null.
export function toolJson(value: unknown, name = "Tool"): any {
  try {
    return JSON.parse(
      JSON.stringify(value ?? null, (_key, item) => {
        if (typeof item === "number" && !Number.isFinite(item))
          throw new PlanError(
            "INVALID",
            `${name} output contains a non-finite number`,
          );
        if (["bigint", "function", "symbol"].includes(typeof item))
          throw new PlanError(
            "INVALID",
            `${name} output contains an unsupported JSON type`,
          );
        return item;
      }),
    );
  } catch (error) {
    if (error instanceof PlanError) throw error;
    throw new PlanError(
      "INVALID",
      `${name} output is not representable as JSON`,
    );
  }
}

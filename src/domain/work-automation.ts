import { object, PlanError, text } from "./plan.ts";

export interface WorkRoute {
  model: string;
  thinking: string;
}
export function workRoute(value: unknown): WorkRoute {
  const r = object(value, ["model", "thinking"]);
  const model = text(r.model, "model", 200),
    thinking = text(r.thinking, "thinking", 100);
  if (!/^[^/\s]+\/[^\s]+$/.test(model) || !thinking.trim())
    throw new PlanError(
      "INVALID",
      'A model needs an exact "provider/model" route and a thinking ID',
    );
  return { model, thinking };
}

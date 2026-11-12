import { projectModelPolicy } from "../domain/model-policy.ts";
import { costMode } from "../domain/model-ladder.ts";
import { quotaMode } from "../domain/subscription-quota.ts";

export const strategyPresets = [
  {
    mode: quotaMode,
    name: "Balanced",
    recommended: true,
    description:
      "Capable models at sensible thinking levels, using your subscriptions.",
  },
  {
    mode: "quality-first",
    name: "Best quality",
    recommended: false,
    description:
      "Strongest models and deeper thinking. Uses your quota faster.",
  },
  {
    mode: costMode,
    name: "Save quota",
    recommended: false,
    description: "The cheapest model that can build the project well.",
  },
] as const;
export const strategyModeLabels: Record<string, string> = Object.fromEntries(
  strategyPresets.map(({ mode, name }) => [mode, name]),
);

export function agentStrategySummary(records: any[]) {
  const policy = projectModelPolicy({ records });
  const mode = strategyModeLabels[policy.mode];
  if (!mode) return "No strategy chosen yet";
  return [
    mode,
    ...(policy.mode === costMode && policy.allowApi === true
      ? ["paid API allowed"]
      : []),
  ].join(" · ");
}

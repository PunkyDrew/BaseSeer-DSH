import type { ViewName } from "./workspace-contract.ts";

// The pages. Each shows one or more of the saved sections, so saved view
// positions and record links keep working: Plan holds the parts (Structure)
// and the flows (Behavior); Build is Work.
export type TabName = "Plan" | "Code" | "Build";
export const tabSections: Record<TabName, ViewName[]> = {
  Plan: ["Structure", "Behavior"],
  Code: ["Code"],
  Build: ["Work"],
};
export const tabOrder: TabName[] = ["Plan", "Code", "Build"];
export function tabOf(section: ViewName): TabName {
  return tabOrder.find((tab) => tabSections[tab].includes(section)) ?? "Plan";
}

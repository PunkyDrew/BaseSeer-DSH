// Presentation meanings, not inferred architectural facts or record migrations.
export const viewMeaning: Record<
  string,
  { name: string; question: string; purpose: string }
> = {
  Structure: {
    name: "Planning",
    purpose: "Plan the system’s responsibilities and boundaries.",
    question:
      "What are the parts of the intended system, and why do they depend on one another?",
  },
  Code: {
    name: "Code",
    purpose: "See what the inspected source contains and how it matches the plan.",
    question:
      "What exists in the inspected source, and where does it disagree with the plan?",
  },
  Behavior: {
    name: "Behavior",
    purpose: "Follow an operation from trigger to outcome.",
    question:
      "What happens during an operation, including data, state changes and failures?",
  },
  Work: {
    name: "Work",
    purpose: "Follow the planned build, its progress and its cost.",
    question: "What needs to be built or checked, by whom, and in what order?",
  },
};
export const recordMeaning: Record<string, string> = {
  component:
    "Component: a part of the software with a defined responsibility and boundary. A planned component may contain several source files.",
  interface:
    "Interface: what passes between parts, by its format and the records that cross it. It is not necessarily a screen or a language interface declaration.",
  requirement:
    "Requirement: a capability or constraint the system must satisfy, with criteria for checking it.",
  task: "Implementation task: work to build, change or verify the software. It is not a component of the running system.",
  decision:
    "Architecture decision: a recorded choice, its rationale and the alternatives considered.",
  question:
    "Open question: an unresolved design constraint or decision. Discuss it in chat.",
  scenario:
    "Scenario: an operation described through its participants, data, state transitions and possible outcomes.",
  mapping:
    "Source mapping: a link to a particular source snapshot and location. It does not by itself verify behavior.",
  claim: "Claim: something about the plan that still needs checking.",
  evidence: "Check result: what was checked, when, and what happened.",
  finding:
    "Finding: a discrepancy or concern to investigate, repair or resolve through an explicit design decision.",
  analysis:
    "Analysis: recorded source inspection with a stated method, coverage and limitations.",
};
/** A saved section that is still a page; anything else opens the parts. */
export function visibleSection(section?: string) {
  return section && viewMeaning[section] ? section : "Structure";
}

// Short explanations for the existing legend labels, not record migrations.
export const elementExplanations: Record<string, string> = {
  component: "A part of the software with a specific job.",
  interface: "The rules for how two parts of the software talk to each other.",
  requirement: "Something the software must do or a rule it must follow.",
  decision: "An important choice about how the software will be built.",
  task: "A piece of work needed to build or check the software.",
  question: "Something about the design that still needs an answer.",
  scenario: "An example of what happens when someone uses the software.",
  mapping: "A connection between a plan item and its place in the code.",
  claim: "A statement that still needs to be backed up by evidence.",
  evidence: "A check or observation that helps show whether something works.",
  finding: "A problem or concern that needs attention.",
  analysis: "An examination of the code to learn how it is put together.",
  "source file": "A file containing code that has been inspected.",
};
export const relationshipExplanations: Record<string, string> = {
  uses: "This part needs the part the arrow points to.",
  "depends-on": "The task the arrow points to must be completed first.",
  implements: "This part is meant to follow the rules set by the interface.",
  satisfies: "This part is meant to meet the requirement the arrow points to.",
  addresses:
    "This decision, task or question concerns the item the arrow points to.",
  "maps-to": "This plan item is connected to a specific place in the code.",
  supports:
    "This evidence gives a reason to believe the statement it points to.",
  contradicts:
    "This evidence suggests the statement it points to may be wrong.",
  value: "This file uses code from the file the arrow points to.",
  type: "This file uses descriptions of data from another file to check for mistakes.",
  dynamic:
    "This file loads another piece of code while the software is running.",
};
export const elementExplanation = (kind: string) =>
  elementExplanations[kind.toLowerCase()] ??
  "An item in the plan; select it to see its details.";
export const relationshipExplanation = (type: string) =>
  relationshipExplanations[type] ??
  "A connection between two items; select the arrow to see its meaning.";

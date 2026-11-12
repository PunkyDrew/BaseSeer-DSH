import type { CodeFile, Declaration } from "../contracts/code.ts";

// Shared by generation selection and source-bound Behavior admission. A known
// written declaration is a candidate for explanation, never executed evidence.
export function isOperationCandidate(file: CodeFile, declaration: Declaration) {
  return (
    declaration.kind === "function" ||
    declaration.kind === "class" ||
    (declaration.kind === "variable" &&
      !!file.calls?.some((call) => call.caller === declaration.name))
  );
}

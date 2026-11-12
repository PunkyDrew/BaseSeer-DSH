import { codeContentAsync, inspectCodeAsync } from "../../analysis/code.ts";
import { object, text, PlanError } from "../../domain/plan.ts";
export async function queryCode(root: string, input: unknown) {
  const q = object(input ?? { action: "inspect" }, [
    "action",
    "digest",
    "path",
  ]);
  if (q.action === "inspect") return inspectCodeAsync(root);
  if (q.action === "freshness")
    return {
      current:
        (await inspectCodeAsync(root)).digest ===
        text(q.digest, "source digest", 64),
      checkedAt: new Date().toISOString(),
    };
  if (q.action === "source") return codeContentAsync(root, q.digest, q.path);
  throw new PlanError("DENIED", "Unsupported read-only code operation");
}

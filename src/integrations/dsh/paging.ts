import { createHash } from "node:crypto";
import { PlanError } from "../../domain/plan.ts";
import { toolJson } from "./tool-json.ts";

/** The most characters one page of a tool's answer holds. */
export const PAGE_SIZE = 4000;

/**
 * One page of a value a tool returns. A value that fits is returned whole;
 * a larger one is returned as JSON text fragments, each naming the hash of the
 * complete value so a reader cannot mix pages of two different versions.
 */
export function pageValue(value: unknown, offset: unknown = 0) {
  if (!Number.isSafeInteger(offset) || (offset as number) < 0)
    throw new PlanError(
      "INVALID",
      "Page offset must be a non-negative safe integer",
    );
  const normalized = toolJson(value, "Context");
  const encoded = JSON.stringify(normalized);
  if ((offset as number) > encoded.length)
    throw new PlanError("INVALID", "Page offset exceeds this value");
  if (offset === 0 && encoded.length <= PAGE_SIZE) return normalized;
  const end = Math.min((offset as number) + PAGE_SIZE, encoded.length);
  return {
    encoding: "json-fragment",
    sha256: createHash("sha256").update(encoded).digest("hex"),
    offset,
    nextOffset: end < encoded.length ? end : null,
    totalChars: encoded.length,
    text: encoded.slice(offset as number, end),
    instruction:
      "This is a fragment of the selected value. Use nextOffset with the same selectors to retrieve more detail; concatenate text from one sha256 for complete JSON.",
  };
}

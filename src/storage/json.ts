import { PlanError } from "../domain/plan.ts";

// Saved data is never repaired by a read: a corrupt file stays as it is, for recovery.
export function stored<T>(label: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new PlanError(
      "CORRUPT",
      `Saved ${label} is corrupt or unsupported; keep the file and recover it from a backup.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
export function json<T>(
  value: string,
  label: string,
  validate: (input: unknown) => T,
): T {
  return stored(label, () => validate(JSON.parse(value)));
}
export function objectValue(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Expected an object");
  return input as Record<string, any>;
}
export function arrayValue(input: unknown): unknown[] {
  if (!Array.isArray(input)) throw Error("Expected an array");
  return input;
}

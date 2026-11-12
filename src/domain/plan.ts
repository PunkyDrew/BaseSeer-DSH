export type Role = "owner" | "planner" | "worker";
export interface Plan {
  id: string;
  revision: number;
  title: string;
}
/** A message the owner wrote in a Planning chat, word for word. */
export interface OwnerMessage {
  time: string;
  text: string;
  /** The planner's last reply to the owner before it, word for word: what an answer answers. */
  replyTo?: string;
}
export class PlanError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details: unknown = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlanError("INVALID", "Expected an object");
  const obj = value as Record<string, unknown>;
  const unexpected = Object.keys(obj).filter((k) => !keys.includes(k));
  if (unexpected.length)
    throw new PlanError(
      "INVALID",
      `Unexpected input field: ${unexpected.join(", ").slice(0, 300)}. Allowed: ${keys.join(", ")}`,
    );
  return obj;
}
export function at<T>(location: string, validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof PlanError)
      throw new PlanError(
        error.code,
        `${location}: ${error.message}`,
        error.details,
      );
    throw error;
  }
}
export function text(value: unknown, name: string, max = 4096): string {
  const problem =
    typeof value !== "string"
      ? `expected text, got ${Array.isArray(value) ? "a list" : typeof value}`
      : value.length > max
        ? `longer than ${max} characters`
        : value.includes("\0")
          ? "contains a NUL character"
          : undefined;
  if (problem) throw new PlanError("INVALID", `Invalid ${name}: ${problem}`);
  return value as string;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new PlanError("INVALID", "Invalid revision");
  return value as number;
}

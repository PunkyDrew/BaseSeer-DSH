// DSH's `json` schema accepts strings too. Commands must be JSON objects;
// detailed operation/record validation remains in the application boundary.
export const recordCommand = {
  type: "object",
  required: true,
  additionalProperties: true,
  properties: { op: { type: "string", required: true } },
} as const;
export const queryCommand = {
  type: "object",
  required: true,
  additionalProperties: true,
  properties: { action: { type: "string", required: true } },
} as const;

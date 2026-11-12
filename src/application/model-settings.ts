import { randomUUID } from "node:crypto";
import type { Records } from "./records.ts";
import {
  modelPolicy,
  projectModelPolicy,
  modelModes,
} from "../domain/model-policy.ts";
import { object, PlanError, revision } from "../domain/plan.ts";

/** Saves the owner's project model policy: the mode, provider preferences and reserves. */
export function saveModelSettings(records: Records, actor: any, input: unknown) {
  records.owner(actor);
  const q = object(input, ["expected", "policy"]);
  const current = records.read(actor.plan);
  if (revision(q.expected) !== current.revision)
    throw new PlanError(
      "CONFLICT",
      "The plan changed. Reload model settings before saving.",
    );
  const policy = modelPolicy(q.policy);
  if (!policy) throw new PlanError("INVALID", "Model settings are incomplete");
  if (!Object.hasOwn(modelModes, policy.mode))
    throw new PlanError(
      "INVALID",
      "Choose a model mode in model settings.",
    );
  const saved = projectModelPolicy(current.document);
  // The stored policy keeps the record's field order; compare normalized forms.
  if (JSON.stringify(policy) === JSON.stringify(modelPolicy(saved)))
    return current;
  const prior = current.document.records.find(
    (r: any) =>
      r.kind === "decision" && r.status !== "superseded" && r.data.modelPolicy,
  );
  return records.execute(actor, {
    op: "batch",
    expected: q.expected,
    key: randomUUID(),
    records: [
      prior
        ? { ...prior, data: { ...prior.data, modelPolicy: policy } }
        : {
            id: randomUUID(),
            kind: "decision",
            version: 1,
            title: "Project model usage",
            status: "draft",
            data: {
              modelPolicy: policy,
              context: "Owner-selected project model priorities",
              choice: "Use the selected mode when choosing build models.",
              alternatives: ["Change the mode in Agent strategy"],
            },
          },
    ],
    links: [],
    reason: "Update project model usage",
  });
}

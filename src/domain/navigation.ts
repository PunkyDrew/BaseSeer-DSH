import { object, PlanError, text } from "./plan.ts";
import { relative } from "./records.ts";

export const sections = ["Code", "Structure", "Behavior", "Work"];
// Display-only diagram notation per graph section. Component and Flow are the
// defaults; an unknown saved value is rejected rather than silently dropped.
export const notations = [
  "uml-component",
  "uml-class",
  "uml-deployment",
  "flow",
  "uml-sequence",
  "matrix",
];
const selection = (v: unknown) => {
  const s = text(v, "saved selection", 200);
  if (/^[A-Za-z]:[\\/]|^\/|\\|\.\./.test(s))
    throw new PlanError(
      "INVALID",
      "Saved selection must not contain a machine path",
    );
  return s;
};
export function navigation(input: unknown = {}) {
  const q = object(input, ["section", "selected", "graphs"]);
  const section = q.section ?? "Structure";
  if (!sections.includes(String(section)))
    throw new PlanError("INVALID", "Unknown saved view");
  const graphs: Record<string, any> = {};
  for (const [key, value] of Object.entries(object(q.graphs ?? {}, sections))) {
    const g = object(value, [
      "viewport",
      "layers",
      "scenario",
      "part",
      "folder",
      "selected",
      "dependencies",
      "notation",
    ]);
    const saved: any = {};
    if (g.notation !== undefined) {
      if (!notations.includes(String(g.notation)))
        throw new PlanError("INVALID", "Invalid diagram notation");
      // Defaults are not stored: only a notation the owner chose is saved.
      if (g.notation !== "uml-component" && g.notation !== "flow")
        saved.notation = g.notation;
    }
    if (g.viewport !== undefined) {
      const v = object(g.viewport, ["x", "y", "zoom", "layoutSignature"]);
      if (v.layoutSignature !== undefined)
        v.layoutSignature = text(
          v.layoutSignature,
          "camera layout signature",
          200,
        );
      if (
        ![v.x, v.y, v.zoom].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        ) ||
        Math.abs(v.x as number) > 1e7 ||
        Math.abs(v.y as number) > 1e7 ||
        (v.zoom as number) < 0.01 ||
        (v.zoom as number) > 1.8
      )
        throw new PlanError("INVALID", "Invalid graph viewport");
      saved.viewport = v;
    }
    if (g.layers !== undefined) {
      const layers = object(g.layers, [
        "dependencies",
        "traceability",
        "sources",
      ]);
      if (Object.values(layers).some((v) => typeof v !== "boolean"))
        throw new PlanError("INVALID", "Invalid relationship layer");
      saved.layers = layers;
    }
    for (const field of ["scenario", "part", "selected", "folder"])
      if (g[field] !== undefined) {
        const v = selection(g[field]);
        if (v && field === "folder") relative(v);
        saved[field] = v;
      }
    if (g.dependencies !== undefined) {
      if (typeof g.dependencies !== "boolean")
        throw new PlanError("INVALID", "Invalid dependency layer");
      saved.dependencies = g.dependencies;
    }
    graphs[key] = saved;
  }
  const selected = selection(q.selected ?? "");
  return { section: String(section), selected, graphs };
}

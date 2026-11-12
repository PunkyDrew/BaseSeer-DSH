import type { CodeSnapshot } from "../contracts/code.ts";
import { mayUse, type Document } from "../domain/records.ts";

// Rules come from the intended module contracts. Signals are not correctness verdicts.
export function compareArchitecture(doc: Document, code: CodeSnapshot) {
  const components = doc.records.filter((r) => r.kind === "component");
  const modules = (file: string) =>
    components.filter((r) => r.data.contract?.sourceTargets.includes(file));
  const concerns: {
    kind: string;
    assessment: string;
    path: string;
    line?: number;
    subject?: string;
    /** For a boundary concern, the component imported. */
    target?: string;
    description: string;
  }[] = [];
  for (const c of components) {
    if (!c.data.contract) {
      concerns.push({
        kind: "coverage",
        assessment: "not-run",
        path: "",
        subject: c.id,
        description: `${c.title}: no files assigned to check.`,
      });
      continue;
    }
    for (const p of c.data.contract.sourceTargets)
      if (!code.files.some((f) => f.path === p))
        concerns.push({
          kind: "missing",
          assessment: "observation",
          path: p,
          subject: c.id,
          description: `${c.title}: planned file was not found. Check skipped files before building it.`,
        });
  }
  for (const f of code.files) {
    const owners = modules(f.path);
    if (!owners.length)
      concerns.push({
        kind: "unplanned",
        assessment: "observation",
        path: f.path,
        description:
          "This file is not assigned to a planned part. Decide which part should own it.",
      });
    if (owners.length > 1)
      concerns.push({
        kind: "responsibility",
        assessment: "hypothesis",
        path: f.path,
        description: `This file is assigned to ${owners.map((o) => o.title).join(", ")}. Decide whether these parts should share this file.`,
      });
    for (const owner of owners)
      for (const dependency of f.imports.filter(
        (i) => i.target && f.coverage === "syntax",
      )) {
        for (const target of modules(dependency.target!))
          if (target.id !== owner.id && !mayUse(owner, target))
            concerns.push({
              kind: "boundary",
              assessment: "rule-violation",
              path: f.path,
              line: dependency.line,
              subject: owner.id,
              target: target.id,
              description: `${owner.title} imports ${target.title}, but the plan does not allow this dependency. Check whether the import or the plan should change.`,
            });
      }
    const imports = new Set(
      f.imports.filter((i) => i.target).map((i) => i.target),
    );
    if (
      imports.size >= 8 &&
      f.declarations.filter((d) => ["function", "class"].includes(d.kind))
        .length >= 8
    )
      concerns.push({
        kind: "coupling",
        assessment: "hypothesis",
        path: f.path,
        description: `${imports.size} local dependencies and several functions or classes. Review whether this file does too many different jobs.`,
      });
  }
  return {
    concerns,
    modules: components.map((component) => {
      const contract = component.data.contract;
      const sources = (contract?.sourceTargets ?? []).map((name: string) => {
        const file = code.files.find((f) => f.path === name);
        return {
          path: name,
          availability: file ? "observed" : "unavailable",
          coverage: file?.coverage ?? "not-run",
          sha256: file?.sha256,
          analysis: file?.analysis && {
            adapter: file.analysis.adapter,
            tool: file.analysis.tool,
            toolVersion: file.analysis.toolVersion,
            capability: file.analysis.capabilities.architecture,
            syntax: file.analysis.capabilities.syntax.status,
            context: file.analysis.context,
          },
          dependencies: (file?.imports ?? []).map((dependency) => ({
            ...dependency,
            modules: dependency.target
              ? modules(dependency.target).map((m) => ({
                  id: m.id,
                  title: m.title,
                }))
              : [],
          })),
        };
      });
      const gaps: string[] = [];
      if (!contract) gaps.push("No dependency rules planned yet.");
      if (!sources.length)
        gaps.push("No source files have been assigned to this component.");
      for (const source of sources) {
        if (
          source.analysis &&
          ["unavailable", "parse-error"].includes(
            source.analysis.capability.status,
          )
        )
          gaps.push(
            `${source.path}: ${source.analysis.capability.status === "parse-error" ? "could not read the code's syntax. Fix syntax errors, then check again" : "this file type cannot be checked for dependencies yet"}.`,
          );
        if (source.analysis?.syntax === "partial")
          gaps.push(`${source.path}: only part of this file could be checked.`);
        if (source.coverage !== "syntax")
          gaps.push(`${source.path}: imports could not be fully checked.`);
        if (source.dependencies.some((d: any) => d.resolution === "unresolved"))
          gaps.push(`${source.path}: some imported files could not be found.`);
        if (source.dependencies.some((d: any) => d.target && !d.modules.length))
          gaps.push(
            `${source.path}: an imported file is not assigned to a planned part.`,
          );
      }
      if (code.partial) gaps.push("Some files were skipped.");
      const violations = concerns.filter(
        (c) => c.kind === "boundary" && c.subject === component.id,
      );
      return {
        id: component.id,
        title: component.title,
        design: {
          record: component.id,
          version: component.version,
          status: component.status,
          provenance: contract
            ? "Recorded intended module contract"
            : "No intended contract; source-inferred descriptions do not grant dependency permission",
        },
        rules: contract
          ? [
              {
                rule: "source-targets",
                description: "Planned files must exist.",
                availability:
                  code.partial ||
                  sources.some((s: any) => s.availability === "unavailable")
                    ? "inconclusive"
                    : "available",
                basis: "Source inventory comparison",
              },
              {
                rule: "allowed-local-dependencies",
                description: "Imports must use only the planned dependencies.",
                availability: gaps.length ? "inconclusive" : "available",
                basis: "Language adapter import bindings",
              },
            ]
          : [],
        observed: component.data.observed ?? null,
        responsibility: component.data.responsibility,
        allowedDependencies: (contract?.allowedDependencies ?? []).map(
          (id: string) => ({
            id,
            title: doc.records.find((r) => r.id === id)?.title ?? id,
          }),
        ),
        sources,
        gaps,
        assessment: violations.length
          ? "rule-violation"
          : gaps.length
            ? "inconclusive"
            : "no-violation-observed",
        qualification:
          "Checks only recorded local import boundaries in assigned source files. Assignment is intended design; observed imports do not establish cohesion, behavior, interface compatibility or conformance to a named architectural pattern.",
      };
    }),
    coverage:
      "Checks assigned files and imports between parts. Missing import targets or unsupported file types prevent a complete check. It does not check duplicate logic or every function call.",
    missingContracts: components.filter((c) => !c.data.contract).length,
  };
}

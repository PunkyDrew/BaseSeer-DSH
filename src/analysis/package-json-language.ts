import path from "node:path";
import { emptyAnalysis } from "./language-facts.ts";
import { analysisLimits, type LanguageAdapter } from "./language-types.ts";

export const packageJsonSource = /(^|\/)package\.json$/;
export const packageJsonToolVersion = `JSON.parse/Node-${process.versions.node}`;

// Manifests are data, not JavaScript programs. Record declared entry points and
// package dependencies without evaluating scripts, loading modules or installing.
export const packageJsonAdapter: LanguageAdapter = {
  id: "package-json",
  version: "1",
  accepts: (name) => packageJsonSource.test(name),
  analyze(files, context, options) {
    const paths = new Set(options.paths ?? files.map((f) => f.path));
    for (const file of files) {
      const facts = (file.analysis = emptyAnalysis(
        file,
        "package-json",
        "JSON manifest parser",
        packageJsonToolVersion,
        context,
      ));
      file.coverage = "syntax";
      file.imports = [];
      file.declarations = [];
      for (const key of ["scopes", "relationships"] as const)
        facts.capabilities[key] = {
          status: "unavailable",
          basis: "parser",
          detail:
            "JSON data does not establish program scopes or runtime behavior.",
        };
      facts.capabilities.architecture.detail =
        "Declared manifest entry points and dependency references only. Script commands are retained data, not executed or qualified shell behavior; runnable behavior requires independent verification.";
      const gap = (detail: string) => {
        facts.capabilities.architecture.status = "unavailable";
        if (facts.gaps.length < 45 && !facts.gaps.includes(detail))
          facts.gaps.push(detail);
      };
      const reference = (specifier: string, local: boolean) => {
        if (file.imports.length >= analysisLimits.facts) {
          gap("Manifest reference limit reached.");
          return;
        }
        let target: string | undefined;
        if (
          local &&
          specifier &&
          !/[\\\u0000-\u0020*?#%]/.test(specifier) &&
          !path.posix.isAbsolute(specifier) &&
          !/^[a-z][a-z\d+.-]*:/i.test(specifier)
        ) {
          const joined = path.posix.normalize(
            path.posix.join(path.posix.dirname(file.path), specifier),
          );
          if (joined !== ".." && !joined.startsWith("../") && paths.has(joined))
            target = joined;
        }
        file.imports.push({
          specifier: specifier || "<empty manifest reference>",
          line: 1,
          kind: "value",
          resolution: target ? "local" : "unresolved",
          ...(target ? { target } : {}),
        });
      };
      const entries = (value: unknown, relativeOnly = false, depth = 0) => {
        if (depth > 20) {
          gap("Manifest entry-point nesting limit reached.");
          return;
        }
        if (typeof value === "string")
          reference(value, !relativeOnly || value.startsWith("./"));
        else if (value === null || value === false) return;
        else if (Array.isArray(value))
          for (const item of value) entries(item, relativeOnly, depth + 1);
        else if (value && typeof value === "object")
          for (const item of Object.values(value))
            entries(item, relativeOnly, depth + 1);
        else gap("Unsupported manifest entry-point value.");
      };
      try {
        const manifest = JSON.parse(file.content);
        if (
          !manifest ||
          typeof manifest !== "object" ||
          Array.isArray(manifest)
        )
          throw Error();
        for (const field of [
          "main",
          "module",
          "types",
          "typings",
          "bin",
          "exports",
          "imports",
        ])
          if (Object.hasOwn(manifest, field))
            entries(
              manifest[field],
              field === "exports" || field === "imports",
            );
        if (typeof manifest.browser === "string")
          reference(manifest.browser, true);
        else if (manifest.browser !== undefined)
          gap("Browser remapping resolution is not qualified.");
        for (const field of [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ]) {
          const dependencies = manifest[field];
          if (dependencies === undefined) continue;
          if (
            !dependencies ||
            typeof dependencies !== "object" ||
            Array.isArray(dependencies)
          ) {
            gap("Unsupported manifest dependency map.");
            continue;
          }
          for (const [name, version] of Object.entries(dependencies)) {
            if (typeof version !== "string") {
              gap("Unsupported dependency version.");
              continue;
            }
            reference(`package:${name}@${version}`, false);
          }
        }
        if (manifest.workspaces !== undefined)
          gap("Workspace package resolution is not qualified.");
        if (
          manifest.scripts !== undefined &&
          (!manifest.scripts ||
            typeof manifest.scripts !== "object" ||
            Array.isArray(manifest.scripts) ||
            Object.values(manifest.scripts).some((v) => typeof v !== "string"))
        )
          gap(
            "Manifest scripts must be command strings; no commands were executed.",
          );
      } catch {
        file.coverage = "parse-error";
        facts.capabilities.syntax.status = "parse-error";
        gap(
          "Package manifest must be a valid JSON object; no source was evaluated.",
        );
      }
    }
  },
};

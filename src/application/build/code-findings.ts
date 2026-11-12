import fs from "node:fs";
import path from "node:path";
import { compareArchitecture } from "../../analysis/architecture.ts";
import { inspectCodeAsync } from "../../analysis/code.ts";
import type { CodeFile, CodeSnapshot } from "../../contracts/code.ts";
import type { Document } from "../../domain/records.ts";

/**
 * What BaseSeer's own source analysis finds in a build's code: checks of its
 * architecture that the code standard asks for but agents do not reliably
 * keep: files that import each other, imports between components the plan
 * did not allow, and function bodies written twice. Cycles and imports the
 * plan does not allow fail the acceptance check; bodies written twice are
 * places to look.
 */
export type CodeFindings = {
  /** Source files that import each other at run time, one list per cycle. */
  cycles: string[][];
  /** Imports between planned components that the plan's allowedDependencies do not allow. */
  unplannedImports: { path: string; line?: number; description: string }[];
  /** Function bodies written word for word in more than one place, longest first. */
  duplicates: { lines: number; places: { path: string; name: string }[] }[];
};

const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** A test, or a file only tests use (such as a fixture), by where it lives or how it is named. */
const isTestFile = (file: string) => TEST_FILE.test(file);

const RUN_TIME_IMPORTS = new Set(["value", "require"]);
/** A shorter body repeated is usually an idiom, not duplicated logic. */
const DUPLICATE_LINES = 8;

/** Groups of files that reach each other through run-time imports (Tarjan's algorithm). */
function importCycles(edges: Map<string, string[]>) {
  const index = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (file: string) => {
    index.set(file, index.size);
    lowest.set(file, index.get(file)!);
    stack.push(file);
    onStack.add(file);
    for (const next of edges.get(file) ?? []) {
      if (!index.has(next)) {
        visit(next);
        lowest.set(file, Math.min(lowest.get(file)!, lowest.get(next)!));
      } else if (onStack.has(next)) {
        lowest.set(file, Math.min(lowest.get(file)!, index.get(next)!));
      }
    }
    if (lowest.get(file) !== index.get(file)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== file);
    if (group.length > 1) cycles.push(group.sort());
  };
  for (const file of [...edges.keys()].sort()) if (!index.has(file)) visit(file);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

/** The lines of a declaration after its first, trimmed, so a body copied under another name still matches. */
function bodyOf(lines: string[], line: number, endLine: number) {
  return lines
    .slice(line, endLine)
    .map((text) => text.trim())
    .filter(Boolean);
}

/** Function bodies that appear word for word in more than one place. */
function duplicateBodies(root: string, source: CodeFile[]) {
  const places = new Map<string, { path: string; name: string }[]>();
  for (const f of source) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(root, f.path), "utf8").split(/\r?\n/);
    } catch {
      continue;
    }
    for (const d of f.declarations) {
      const body = bodyOf(lines, d.line, d.endLine);
      if (body.length < DUPLICATE_LINES) continue;
      const key = body.join("\n");
      places.set(key, [...(places.get(key) ?? []), { path: f.path, name: d.name }]);
    }
  }
  return [...places.entries()]
    .filter(([, found]) => found.length > 1)
    .map(([key, found]) => ({ lines: key.split("\n").length, places: found }))
    .sort((a, b) => b.lines - a.lines);
}

/** Imports between planned components that the plan does not allow, outside the tests. */
function unplannedImports(doc: Document, code: CodeSnapshot) {
  return compareArchitecture(doc, code)
    .concerns.filter((c) => c.kind === "boundary" && !isTestFile(c.path))
    .map((c) => ({
      path: c.path,
      ...(c.line ? { line: c.line } : {}),
      description: c.description,
    }));
}

function codeFindings(
  code: CodeSnapshot,
  context: { root?: string; doc?: Document } = {},
): CodeFindings {
  const source = code.files.filter((f) => !isTestFile(f.path));
  const paths = new Set(source.map((f) => f.path));
  const edges = new Map(
    source.map((f) => [
      f.path,
      f.imports
        .filter((i) => RUN_TIME_IMPORTS.has(i.kind) && i.target && paths.has(i.target))
        .map((i) => i.target!),
    ]),
  );
  return {
    cycles: importCycles(edges),
    unplannedImports: context.doc ? unplannedImports(context.doc, code) : [],
    duplicates: context.root ? duplicateBodies(context.root, source) : [],
  };
}

/**
 * The findings for a project folder, read against the plan when one is
 * given, or nothing when its source cannot be analyzed.
 */
export async function inspectFindings(
  root: string,
  doc?: Document,
): Promise<CodeFindings | undefined> {
  try {
    return codeFindings(await inspectCodeAsync(root), { root, doc });
  } catch {
    return undefined;
  }
}

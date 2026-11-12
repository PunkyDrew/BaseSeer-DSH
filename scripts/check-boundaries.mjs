import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Module-boundary rule. Each top-level folder under src/ is a layer and
// may import only the layers listed here, by value or by type. Imports within a
// layer are always allowed. Nothing outside integrations may import ui or
// integrations. Known exceptions and cycles are frozen in
// boundary-exceptions.json: the list may only shrink, so a new violation fails
// and a fixed one must be removed from the list.
export const LAYERS = {
  domain: [],
  contracts: ["domain"],
  analysis: ["domain", "contracts"],
  storage: ["domain", "contracts"],
  application: ["domain", "contracts", "analysis", "storage"],
  ui: ["domain", "contracts"],
  integrations: [
    "domain",
    "contracts",
    "analysis",
    "storage",
    "application",
    "ui",
  ],
};
const exceptionsFile = path.join(
  import.meta.dirname,
  "boundary-exceptions.json",
);

const sourceFile = (name) => /\.[cm]?tsx?$/.test(name) && !/\.d\.ts$/.test(name);
const posix = (name) => name.replaceAll("\\", "/");

// Resolve a relative specifier to an existing src-relative file.
function resolveImport(root, from, specifier) {
  const base = path.resolve(path.dirname(path.join(root, from)), specifier);
  for (const candidate of [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return posix(path.relative(root, candidate));
  return posix(path.relative(root, base));
}

// Every relative import, re-export and literal dynamic import, with whether it
// is erased at runtime (type-only).
export function importsOf(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (node, specifier, typeOnly) =>
    found.push({
      specifier,
      typeOnly,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        !!clause?.isTypeOnly ||
        (!!clause &&
          !clause.name &&
          !!named &&
          ts.isNamedImports(named) &&
          named.elements.length > 0 &&
          named.elements.every((element) => element.isTypeOnly));
      add(node, node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const named = node.exportClause;
      add(
        node,
        node.moduleSpecifier.text,
        node.isTypeOnly ||
          (!!named &&
            ts.isNamedExports(named) &&
            named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly)),
      );
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      add(node, node.arguments[0].text, false);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      add(node, node.argument.literal.text, true);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter(({ specifier }) => specifier.startsWith("."));
}

export function importGraph(root) {
  const edges = [];
  for (const name of fs.readdirSync(root, { recursive: true }).map(posix)) {
    if (!sourceFile(name)) continue;
    const text = fs.readFileSync(path.join(root, name), "utf8");
    for (const item of importsOf(name, text))
      edges.push({
        from: name,
        to: resolveImport(root, name, item.specifier),
        line: item.line,
        typeOnly: item.typeOnly,
      });
  }
  return edges;
}

const layerOf = (file) => (file.includes("/") ? file.split("/")[0] : null);

export function layerViolations(edges) {
  const findings = new Map();
  for (const edge of edges) {
    const from = layerOf(edge.from),
      to = layerOf(edge.to);
    let rule;
    if (!from || !(from in LAYERS))
      rule = `Unknown layer for ${edge.from}; add it to LAYERS deliberately`;
    else if (!to || !(to in LAYERS))
      rule = `Import leaves the known layers: ${edge.to}`;
    else if (from !== to && !LAYERS[from].includes(to))
      rule = `${from} may not import ${to}`;
    if (!rule) continue;
    // Exceptions are per file pair so line movement does not churn the list.
    const key = `${edge.from} -> ${edge.to}`;
    const prior = findings.get(key);
    findings.set(key, {
      from: edge.from,
      to: edge.to,
      kind: prior?.kind === "value" || !edge.typeOnly ? "value" : "type",
      lines: [...(prior?.lines ?? []), edge.line],
      rule,
    });
  }
  return [...findings.values()].sort((a, b) =>
    `${a.from} ${a.to}`.localeCompare(`${b.from} ${b.to}`),
  );
}

// Strongly connected components of the type-inclusive import graph.
export function importCycles(edges) {
  const graph = new Map();
  for (const { from, to } of edges) {
    if (!graph.has(from)) graph.set(from, new Set());
    if (!graph.has(to)) graph.set(to, new Set());
    graph.get(from).add(to);
  }
  let next = 0;
  const index = new Map(),
    low = new Map(),
    stack = [],
    onStack = new Set(),
    cycles = [];
  for (const start of graph.keys()) {
    if (index.has(start)) continue;
    // Iterative Tarjan so deep graphs cannot overflow the call stack.
    const work = [[start, [...graph.get(start)], 0]];
    index.set(start, next);
    low.set(start, next++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work.at(-1);
      const [node, targets] = frame;
      if (frame[2] < targets.length) {
        const target = targets[frame[2]++];
        if (!index.has(target)) {
          index.set(target, next);
          low.set(target, next++);
          stack.push(target);
          onStack.add(target);
          work.push([target, [...graph.get(target)], 0]);
        } else if (onStack.has(target))
          low.set(node, Math.min(low.get(node), index.get(target)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work.at(-1)[0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const members = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          members.push(member);
        } while (member !== node);
        if (members.length > 1) cycles.push(members.sort());
      }
    }
  }
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

export function readExceptions(file = exceptionsFile) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    value.rule !== "c124-module-boundaries-v1" ||
    !Array.isArray(value.layers) ||
    !Array.isArray(value.cycles)
  )
    throw new Error("Invalid boundary exception list");
  return value;
}

// A recorded cycle covers a found cycle when every member is listed; cycles
// may shrink or split but never gain members.
const covers = (allowed, found) => found.every((m) => allowed.includes(m));

export function checkBoundaries(
  root = process.cwd(),
  exceptions = readExceptions(),
) {
  const src = path.join(root, "src");
  const edges = importGraph(src);
  const layers = layerViolations(edges);
  const cycles = importCycles(edges);
  const allowed = new Map(
    exceptions.layers.map((item) => [`${item.from} -> ${item.to}`, item]),
  );
  const failures = [];
  for (const finding of layers) {
    const exception = allowed.get(`${finding.from} -> ${finding.to}`);
    if (!exception)
      failures.push({ ...finding, problem: "new boundary violation" });
    else if (exception.kind === "type" && finding.kind === "value")
      failures.push({
        ...finding,
        problem: "a type-only exception became a value import",
      });
  }
  const present = new Set(layers.map((f) => `${f.from} -> ${f.to}`));
  for (const key of allowed.keys())
    if (!present.has(key))
      failures.push({
        exception: key,
        problem: "fixed; remove it from boundary-exceptions.json",
      });
  for (const cycle of cycles)
    if (!exceptions.cycles.some((allowedCycle) => covers(allowedCycle, cycle)))
      failures.push({ cycle, problem: "new import cycle" });
  for (const allowedCycle of exceptions.cycles)
    if (!cycles.some((cycle) => covers(allowedCycle, cycle)))
      failures.push({
        cycle: allowedCycle,
        problem: "cycle removed; delete it from boundary-exceptions.json",
      });
  for (const cycle of cycles) {
    const recorded = exceptions.cycles.find((c) => covers(c, cycle));
    if (recorded && recorded.length > cycle.length)
      failures.push({
        cycle: recorded,
        now: cycle,
        problem: "cycle shrank; record the smaller cycle",
      });
  }
  return {
    rule: "c124-module-boundaries-v1",
    passed: failures.length === 0,
    files: new Set(edges.map((e) => e.from)).size,
    edges: edges.length,
    exceptions: { layers: allowed.size, cycles: exceptions.cycles.length },
    failures,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.includes("--current")) {
    // Prints the current findings in exception-list form for review only.
    const edges = importGraph(path.resolve("src"));
    console.log(
      JSON.stringify(
        {
          rule: "c124-module-boundaries-v1",
          layers: layerViolations(edges).map(({ from, to, kind }) => ({
            from,
            to,
            kind,
          })),
          cycles: importCycles(edges),
        },
        null,
        2,
      ),
    );
  } else {
    const result = checkBoundaries();
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}

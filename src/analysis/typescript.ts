import ts from "typescript";
import path from "node:path";
import type { CodeFile, ImportObservation } from "../contracts/code.ts";

export function extractTypeScript(
  file: CodeFile,
  content: string,
  paths: Set<string>,
) {
  const source = ts.createSourceFile(
    file.path,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const line = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const observe = (
    specifier: string,
    node: ts.Node,
    kind: ImportObservation["kind"],
  ) => {
    let target: string | undefined;
    if (specifier.startsWith(".")) {
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.path), specifier),
      );
      const stem = base.replace(/\.(mjs|cjs|js|jsx)$/, "");
      // Conventional relative paths only. No project tsconfig, loaders or package code runs.
      target = [
        base,
        ...[
          ".ts",
          ".tsx",
          ".mts",
          ".cts",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
        ].flatMap((ext) => [stem + ext, base + "/index" + ext]),
      ].find((p) => paths.has(p));
    }
    file.imports.push({
      specifier,
      line: line(node),
      kind,
      target,
      resolution: target
        ? "local"
        : specifier.startsWith(".") ||
            specifier.startsWith("/") ||
            specifier.startsWith("#") ||
            specifier.startsWith("@/")
          ? "unresolved"
          : "external",
    });
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      observe(
        node.moduleSpecifier.text,
        node,
        node.importClause?.isTypeOnly ? "type" : "value",
      );
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      observe(
        node.moduleSpecifier.text,
        node,
        node.isTypeOnly ? "type" : "value",
      );
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      observe(node.moduleReference.expression.text, node, "require");
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg))
        observe(
          arg.text,
          node,
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? "dynamic"
            : "require",
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const node of source.statements) {
    const add = (name: string, n: ts.Node, kind: string) =>
      file.declarations.push({
        name,
        kind,
        line: line(n),
        endLine: source.getLineAndCharacterOfPosition(n.end).line + 1,
      });
    if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name))
          add(declaration.name.text, declaration, "variable");
      }
    else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    )
      add(
        node.name.text,
        node,
        ts.isFunctionDeclaration(node)
          ? "function"
          : ts.isClassDeclaration(node)
            ? "class"
            : ts.isInterfaceDeclaration(node)
              ? "interface"
              : ts.isEnumDeclaration(node)
                ? "enum"
                : "type",
      );
  }
  // Pinned parser boundary; regression cases qualify this diagnostics field.
  file.coverage = (
    source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics.length
    ? "parse-error"
    : "syntax";
  file.calls = [];
  const calls = (node: ts.Node, caller = "<module>") => {
    if (ts.isFunctionDeclaration(node) && node.name) caller = node.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      caller = node.name.text;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source).slice(0, 160);
      file.calls!.push({
        caller,
        callee,
        line: line(node),
        resolution:
          ts.isIdentifier(node.expression) &&
          file.declarations.some(
            (d) => d.kind === "function" && d.name === callee,
          )
            ? "same-file-name"
            : "unresolved",
      });
    }
    ts.forEachChild(node, (child) => calls(child, caller));
  };
  calls(source);
}

import ts from "typescript";
import { extractTypeScript } from "./typescript.ts";
import { emptyAnalysis } from "./language-facts.ts";
import { analysisLimits, type LanguageAdapter } from "./language-types.ts";
import { type SourceRange } from "../contracts/language-analysis.ts";

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  version: "1",
  accepts: (name) => /\.[cm]?[jt]sx?$/i.test(name),
  analyze(files, context, settings) {
    const paths = new Set(settings.paths ?? files.map((f) => f.path));
    const contents = new Map(files.map((f) => ["/" + f.path, f.content]));
    const normalize = (name: string) => name.replaceAll("\\", "/");
    const options: ts.CompilerOptions = {
      allowJs: true,
      checkJs: true,
      noLib: true,
      noEmit: true,
      target: ts.ScriptTarget.Latest,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowImportingTsExtensions: true,
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name, target) => {
        const text = contents.get(normalize(name));
        return text === undefined
          ? undefined
          : ts.createSourceFile(name, text, target, true);
      },
      getDefaultLibFileName: () => "/__unavailable_lib__.d.ts",
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getDirectories: () => [],
      fileExists: (name) => contents.has(normalize(name)),
      readFile: (name) => contents.get(normalize(name)),
      directoryExists: (name) =>
        [...contents.keys()].some((p) =>
          p.startsWith(normalize(name).replace(/\/$/, "") + "/"),
        ),
      getCanonicalFileName: (name) => normalize(name),
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    };
    const program = ts.createProgram([...contents.keys()], options, host),
      checker = program.getTypeChecker();
    const range = (node: ts.Node): SourceRange => {
      const source = node.getSourceFile(),
        start = node.getStart(source),
        end = node.getEnd();
      const a = source.getLineAndCharacterOfPosition(start),
        b = source.getLineAndCharacterOfPosition(end),
        starts = source.getLineStarts();
      return {
        startLine: a.line + 1,
        startColumn: Buffer.byteLength(
          source.text.slice(starts[a.line], start),
        ),
        endLine: b.line + 1,
        endColumn: Buffer.byteLength(source.text.slice(starts[b.line], end)),
      };
    };
    const identity = (node: ts.Node) =>
      `${node.getSourceFile().fileName.slice(1)}:${node.getStart()}:${ts.SyntaxKind[node.kind]}`;
    const declarations = new Map<ts.Node, { id: string; range: SourceRange }>();
    for (const file of files) {
      extractTypeScript(file, file.content, paths);
      file.analysis = emptyAnalysis(
        file,
        "typescript",
        "TypeScript",
        ts.version,
        context,
        file.coverage === "parse-error" ? "parse-error" : "supported",
      );
      const a = file.analysis,
        source = program.getSourceFile("/" + file.path)!;
      a.gaps.push(
        "Conventional relative modules; tsconfig aliases, package exports, custom loaders and installed libraries are not resolved. Written references do not establish runtime dispatch.",
      );
      if (file.coverage === "parse-error") continue;
      const visit = (node: ts.Node, scope: string, functionScope = "") => {
        if (a.symbols.length + a.scopes.length >= analysisLimits.facts) return;
        const named = node as ts.NamedDeclaration;
        if (
          named.name &&
          (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name)) &&
          (ts.isDeclarationStatement(node) ||
            ts.isVariableDeclaration(node) ||
            ts.isBindingElement(node) ||
            ts.isParameter(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isMethodSignature(node) ||
            ts.isPropertySignature(node) ||
            ts.isImportSpecifier(node) ||
            ts.isImportClause(node) ||
            ts.isNamespaceImport(node))
        ) {
          let owner = scope;
          let declaration: ts.Node = node;
          while (
            ts.isBindingElement(declaration) ||
            ts.isObjectBindingPattern(declaration) ||
            ts.isArrayBindingPattern(declaration)
          )
            declaration = declaration.parent;
          if (
            ts.isVariableDeclaration(declaration) &&
            ts.isVariableDeclarationList(declaration.parent) &&
            !(declaration.parent.flags & ts.NodeFlags.BlockScoped)
          )
            owner = functionScope || scope;
          const symbol = {
            id: identity(node),
            name: named.name.text.slice(0, 300),
            kind: ts.SyntaxKind[node.kind],
            scope: owner,
            range: range(node),
          };
          a.symbols.push(symbol);
          declarations.set(node, symbol);
        }
        if (
          ts.isSourceFile(node) ||
          ts.isFunctionLike(node) ||
          ts.isClassLike(node) ||
          ts.isBlock(node) ||
          ts.isModuleDeclaration(node)
        ) {
          const id = identity(node);
          a.scopes.push({
            id,
            name: ts.isSourceFile(node)
              ? "<module>"
              : (named.name?.getText(source).slice(0, 300) ?? "<block>"),
            kind: ts.SyntaxKind[node.kind],
            ...(scope ? { parent: scope } : {}),
            range: range(node),
          });
          scope = id;
          if (
            ts.isSourceFile(node) ||
            ts.isFunctionLike(node) ||
            ts.isModuleDeclaration(node)
          )
            functionScope = id;
        }
        ts.forEachChild(node, (child) => visit(child, scope, functionScope));
      };
      visit(source, "");
    }
    for (const file of files) {
      const a = file.analysis!,
        source = program.getSourceFile("/" + file.path)!;
      if (file.coverage === "parse-error") continue;
      const scopeIds = new Set(a.scopes.map((s) => s.id));
      const visit = (node: ts.Node, scope: string) => {
        if (a.relationships.length >= analysisLimits.facts) return;
        if (scopeIds.has(identity(node))) scope = identity(node);
        let expression: ts.Node | undefined,
          kind: "call" | "reference" | "inherits" = "reference";
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          expression = node.expression;
          kind = "call";
        } else if (ts.isExpressionWithTypeArguments(node)) {
          expression = node.expression;
          kind = "inherits";
        }
        // Calls and inheritance provide useful bounded cross-file symbol relationships.
        if (expression) {
          if (
            ts.isCallExpression(node) &&
            (expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(expression) && expression.text === "require"))
          ) {
            const arg = node.arguments[0],
              dynamic = !arg || !ts.isStringLiteralLike(arg);
            const shadowed =
              ts.isIdentifier(expression) &&
              !!checker.getSymbolAtLocation(expression)?.declarations?.length;
            if (dynamic)
              file.imports.push({
                specifier: "<dynamic module expression>",
                line: range(node).startLine,
                kind:
                  expression.kind === ts.SyntaxKind.ImportKeyword
                    ? "dynamic"
                    : "require",
                resolution: "unresolved",
              });
            if (shadowed)
              for (const observed of file.imports.filter(
                (i) => i.kind === "require" && i.line === range(node).startLine,
              )) {
                delete observed.target;
                observed.resolution = "unresolved";
              }
          }
          let symbol = checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(expression)
              ? expression.name
              : expression,
          );
          if (symbol && symbol.flags & ts.SymbolFlags.Alias)
            symbol = checker.getAliasedSymbol(symbol);
          const candidates = (symbol?.getDeclarations() ?? []).filter(
            (d) =>
              declarations.has(d) &&
              (kind !== "call" ||
                ts.isFunctionLike(d) ||
                ts.isClassLike(d) ||
                (ts.isVariableDeclaration(d) &&
                  !!d.initializer &&
                  (ts.isArrowFunction(d.initializer) ||
                    ts.isFunctionExpression(d.initializer)))),
          );
          const target = candidates.length === 1 ? candidates[0] : undefined;
          a.relationships.push({
            kind,
            spelling: expression.getText(source).slice(0, 160),
            scope,
            range: range(node),
            resolution: target ? "resolved" : "unresolved",
            ...(target
              ? {
                  target: {
                    path: target.getSourceFile().fileName.slice(1),
                    symbol: declarations.get(target)!.id,
                    range: declarations.get(target)!.range,
                  },
                }
              : {
                  reason:
                    "No unique inspected declaration binding; dynamic dispatch, overloads or external context may be required.",
                }),
          });
        }
        ts.forEachChild(node, (child) => visit(child, scope));
      };
      visit(source, "");
      if (
        a.relationships.length >= analysisLimits.facts ||
        a.symbols.length + a.scopes.length >= analysisLimits.facts
      ) {
        a.gaps.push("Per-file fact limit reached; narrow the scan scope.");
        for (const c of Object.values(a.capabilities)) c.status = "partial";
      }
    }
  },
};

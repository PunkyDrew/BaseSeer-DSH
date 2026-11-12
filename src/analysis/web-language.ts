import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";
import parseCss from "css-tree/parser";
import walkCss from "css-tree/walker";
import { tokenize, tokenNames } from "css-tree/tokenizer";
import { ident } from "css-tree/utils";
import { marked } from "marked";
import path from "node:path";
import { emptyAnalysis } from "./language-facts.ts";
import { analysisLimits, type LanguageAdapter } from "./language-types.ts";

const css = { parse: parseCss, walk: walkCss, tokenize, tokenNames, ident };

// Pinned parser identity is part of every cache and retained-tool receipt.
export const webToolVersion = "parse5@8.0.1/css-tree@3.2.1/marked@18.1.0";
export const webSource = /\.(html|htm|css|md|markdown)$/i;
export const webAdapter: LanguageAdapter = {
  id: "web-assets",
  version: "1",
  accepts: (name) => webSource.test(name),
  analyze(files, context, options) {
    const paths = new Set(options.paths ?? files.map((f) => f.path));
    for (const file of files) {
      const facts = (file.analysis = emptyAnalysis(
        file,
        "web-assets",
        "HTML, CSS and Markdown parsers",
        webToolVersion,
        context,
      ));
      file.coverage = "syntax";
      file.imports = [];
      file.declarations = [];
      facts.capabilities.scopes = {
        status: "unavailable",
        basis: "parser",
        detail: "Document assets do not establish program scopes.",
      };
      facts.capabilities.relationships = {
        status: "unavailable",
        basis: "parser",
        detail: "No runtime calls or DOM behavior inferred.",
      };
      facts.capabilities.architecture.detail =
        "Static document resource dependencies only. Embedded scripts, dynamic resources and unsupported constructs remain explicit gaps.";
      const gap = (detail: string) => {
        facts.capabilities.architecture.status = "unavailable";
        if (facts.gaps.length < 45 && !facts.gaps.includes(detail))
          facts.gaps.push(detail);
      };
      const resource = (value: string, line = 1) => {
        if (file.imports.length >= analysisLimits.facts) {
          gap("Document dependency limit reached.");
          return;
        }
        const specifier = value.trim();
        if (specifier.startsWith("#")) return; // Same-document fragment.
        let target: string | undefined;
        // URL resolution uses a synthetic root, never the filesystem or network.
        // Reject ambiguous encodings/separators and root escapes instead of guessing.
        try {
          if (!specifier || /[\\\u0000-\u0020]/.test(specifier)) throw Error();
          const decoded = decodeURIComponent(specifier.split(/[?#]/, 1)[0]);
          if (/[\\\u0000-\u0020?#%]/.test(decoded)) throw Error();
          if (
            !/^[a-z][a-z\d+.-]*:/i.test(specifier) &&
            !specifier.startsWith("//")
          ) {
            const joined = path.posix.normalize(
              specifier.startsWith("/")
                ? decoded.slice(1)
                : path.posix.join(path.posix.dirname(file.path), decoded),
            );
            if (
              joined !== ".." &&
              !joined.startsWith("../") &&
              paths.has(joined)
            )
              target = joined;
          }
        } catch {
          /* Retain an unresolved observation. */
        }
        file.imports.push({
          specifier: specifier || "<empty resource>",
          line: Math.min(file.lines, Math.max(1, line)),
          kind: "value",
          resolution: target ? "local" : "unresolved",
          ...(target ? { target } : {}),
        });
      };
      const stylesheet = (text: string, inline = false, startLine = 1) => {
        // CSS browsers recover at EOF. Recovery must not hide truncated resource
        // values in an architecture receipt, so require balanced lexical tokens.
        const stack: string[] = [];
        css.tokenize(text, (type, start, end) => {
          const name = css.tokenNames[type],
            raw = text.slice(start, end);
          const pairs: Record<string, string> = {
            "{-token": "}-token",
            "[-token": "]-token",
            "(-token": ")-token",
            "function-token": ")-token",
          };
          if (pairs[name]) stack.push(pairs[name]);
          else if (
            ["}-token", "]-token", ")-token"].includes(name) &&
            stack.pop() !== name
          )
            throw Error("Unbalanced CSS");
          if (
            ["bad-string-token", "bad-url-token"].includes(name) ||
            (name === "comment-token" && !raw.endsWith("*/"))
          )
            throw Error("Truncated CSS token");
          if (name === "string-token" || name === "url-token") {
            const closing = name === "string-token" ? raw[0] : ")";
            const escapes = raw.slice(0, -1).match(/\\+$/)?.[0].length ?? 0;
            if (raw.length < 2 || !raw.endsWith(closing) || escapes % 2)
              throw Error("Truncated CSS value");
          }
        });
        if (stack.length) throw Error("Unclosed CSS block");
        const ast = css.parse(text, {
          context: inline ? "declarationList" : "stylesheet",
          positions: true,
          parseCustomProperty: true,
          onParseError: (error) => {
            throw error;
          },
        });
        css.walk(ast, function (node) {
          const line = startLine + (node.loc?.start.line ?? 1) - 1;
          if (node.type === "Raw")
            gap(
              "CSS contains syntax whose resource dependencies cannot be established.",
            );
          if (node.type === "Url") resource(node.value, line);
          if (node.type === "Atrule") {
            const name = css.ident.decode(node.name).toLowerCase();
            if (
              ![
                "import",
                "charset",
                "namespace",
                "media",
                "supports",
                "font-face",
                "keyframes",
                "-webkit-keyframes",
                "page",
                "layer",
                "container",
                "scope",
                "starting-style",
                "property",
                "font-feature-values",
                "font-palette-values",
                "position-try",
                "view-transition",
                "counter-style",
              ].includes(name)
            )
              gap("Unknown CSS at-rule resource semantics are not qualified.");
            if (name === "import") {
              if (node.prelude?.type !== "AtrulePrelude")
                gap("CSS import has no static resource.");
              else {
                const first = node.prelude.children.first;
                if (first?.type === "String") resource(first.value, line);
                else if (first?.type !== "Url")
                  gap("CSS import has no static resource.");
              }
            }
          }
          if (node.type === "Function") {
            const name = css.ident.decode(node.name).toLowerCase();
            if (
              [
                "expression",
                "url",
                "src",
                "image",
                "paint",
                "attr",
                "cross-fade",
                "-webkit-cross-fade",
              ].includes(name)
            )
              gap(
                "CSS contains an unsupported executable or dynamic resource function.",
              );
            if (["image-set", "-webkit-image-set"].includes(name))
              node.children.forEach((child) => {
                if (child.type === "String") resource(child.value, line);
                if (
                  child.type === "Function" &&
                  css.ident.decode(child.name).toLowerCase() !== "type"
                )
                  gap("Dynamic CSS image-set resources are not qualified.");
              });
          }
          if (
            node.type === "Declaration" &&
            ["behavior", "-moz-binding"].includes(
              css.ident.decode(node.property).toLowerCase(),
            )
          )
            gap("Legacy executable CSS is not supported.");
        });
      };
      const html = (text: string, markdown = false) => {
        const document = parseHtml(text, {
          sourceCodeLocationInfo: true,
          onParseError: (error) => {
            if (error.code !== "missing-doctype")
              throw Error("HTML parse error: " + error.code);
          },
        });
        const pending: DefaultTreeAdapterMap["node"][] = [document];
        while (pending.length) {
          const node = pending.pop()!;
          if ("childNodes" in node) pending.push(...node.childNodes);
          if (!("tagName" in node)) continue;
          if ("content" in node)
            pending.push(node.content as DefaultTreeAdapterMap["node"]);
          const line = markdown ? 1 : (node.sourceCodeLocation?.startLine ?? 1);
          const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
          const tag = node.tagName;
          if (node.namespaceURI !== "http://www.w3.org/1999/xhtml")
            gap(
              "Foreign SVG/MathML content requires a qualified dependency adapter.",
            );
          if (
            ["base", "object", "embed", "iframe"].includes(tag) ||
            attrs.has("srcdoc")
          )
            gap(
              "Embedded documents, plugins and base-URL overrides require a qualified dependency adapter.",
            );
          if (tag === "meta" && attrs.has("http-equiv"))
            gap("HTTP-equivalent document directives are not qualified.");
          for (const [name, value] of attrs) {
            if (name.startsWith("on"))
              gap(
                "Inline event handlers are not qualified; use an independently analyzed script module.",
              );
            if (name === "style") stylesheet(value, true, line);
            if (
              [
                "srcset",
                "imagesrcset",
                "archive",
                "codebase",
                "manifest",
              ].includes(name)
            )
              gap("Compound document resource attributes are not qualified.");
            if (
              ["src", "poster", "data"].includes(name) ||
              (name === "href" && tag === "link")
            )
              resource(value, line);
            if (
              ["href", "action", "formaction"].includes(name) &&
              /^(?:javascript|data|vbscript):/i.test(
                value.replace(/[\u0000-\u0020]/g, ""),
              )
            )
              gap("Executable document URLs are not qualified.");
          }
          const content = node.childNodes
            .map((n) => ("value" in n ? n.value : ""))
            .join("");
          if (tag === "script" && (!attrs.has("src") || content.trim()))
            gap(
              "Inline scripts/import maps require a qualified embedded-language adapter; use an external script module.",
            );
          if (tag === "style") stylesheet(content, false, line);
        }
      };
      try {
        if (/\.css$/i.test(file.path)) stylesheet(file.content);
        else if (/\.(md|markdown)$/i.test(file.path)) {
          // Parse Markdown first: fenced examples remain escaped prose, while
          // raw HTML and resource-bearing images are inspected as documents.
          html(marked.parse(file.content, { async: false }), true);
          facts.capabilities.syntax.detail =
            "Parsed Markdown with escaped code examples; generated-document dependency positions are reported at the document start.";
        } else html(file.content);
      } catch {
        file.coverage = "parse-error";
        facts.capabilities.syntax.status = "parse-error";
        gap(
          "Document parsing failed; syntax/dependency coverage is unavailable.",
        );
      }
    }
  },
};

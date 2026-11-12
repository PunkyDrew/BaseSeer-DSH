import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { safePath } from "./source.ts";
import { privatePath, secretText } from "./source-policy.ts";
export const sha256 = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const languages: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  zon: "Zig configuration (not evaluated)",
  c: "C",
  h: "C/C++",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  csx: "C# script (unqualified)",
  csproj: ".NET project configuration",
  vbproj: ".NET project configuration",
  fsproj: ".NET project configuration",
  sln: ".NET solution configuration",
  slnx: ".NET solution configuration",
  props: "Build properties (not evaluated)",
  targets: "Build targets (not evaluated)",
  go: "Go",
  java: "Java",
  rb: "Ruby",
  rake: "Ruby (context unavailable)",
  gemspec: "Ruby (context unavailable)",
  php: "PHP",
  phtml: "PHP (context unavailable)",
  php5: "PHP (context unavailable)",
  php7: "PHP (context unavailable)",
  php8: "PHP (context unavailable)",
  swift: "Swift",
  kt: "Kotlin",
  sql: "SQL",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  json: "JSON",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  markdown: "Markdown",
  txt: "Text",
  ps1: "PowerShell",
  sh: "Shell",
  bash: "Bash",
  pyi: "Python stub (source only)",
  pyw: "Python GUI source (source only)",
  scala: "Scala",
  sc: "Scala script (source only)",
  sbt: "sbt configuration (source only)",
  properties: "Properties configuration",
  groovy: "Groovy",
  vb: "Visual Basic (project dialect unqualified)",
  bas: "Classic Visual Basic / VBA (dialect unqualified)",
  cls: "Class export (dialect unqualified)",
  frm: "Form export (host context unqualified)",
  ctl: "Control export (host context unqualified)",
  vbp: "VB6 project context (not evaluated)",
  vbg: "VB6 group context (not evaluated)",
  cc: "C++",
  cxx: "C++",
  hh: "C/C++",
  hxx: "C++",
  m: "Objective-C / MATLAB (ambiguous)",
  mm: "Objective-C++",
  xcconfig: "Xcode configuration (not evaluated)",
  pbxproj: "Xcode project configuration (not evaluated)",
  modulemap: "Clang module configuration (not evaluated)",
  kts: "Kotlin script",
  lua: "Lua",
  rockspec: "Lua (context unavailable)",
  pl: "Perl",
  pm: "Perl module",
  dart: "Dart",
  r: "R",
  jl: "Julia",
  fs: "F#",
  fsx: "F# script (unqualified)",
  fsi: "F# signature (unqualified)",
  ex: "Elixir",
  exs: "Elixir script",
  erl: "Erlang",
  hs: "Haskell",
  asm: "Assembly (dialect unqualified)",
  nasm: "Assembly (dialect unqualified)",
  s: "Assembly (dialect unqualified)",
  zig: "Zig",
  f90: "Fortran",
  f: "Fortran (source form unqualified)",
  adb: "Ada",
  ads: "Ada",
  pas: "Pascal (dialect unqualified)",
  pp: "Pascal (dialect unqualified)",
  dpr: "Delphi program (unqualified)",
  lpr: "Pascal program (unqualified)",
  dpk: "Delphi package (unqualified)",
  inc: "Include context (unqualified)",
  dproj: "Delphi project configuration (not evaluated)",
  lpi: "Lazarus project configuration (not evaluated)",
  lpk: "Lazarus package configuration (not evaluated)",
  cob: "COBOL",
  cbl: "COBOL",
  sas: "SAS",
  abap: "ABAP",
};
type InventoryLimits = Readonly<{
  entries: number;
  bytes: number;
  depth: number;
}>;
// Bounds on the memory and time a scan may take, since the inventory is read
// whole into memory on a request; neither callers nor workers raise them. A
// scan that stops at one says so in `incomplete`, since whoever reads the
// result would otherwise take the part for the whole.
const browseLimits: InventoryLimits = Object.freeze({
  entries: 2000,
  bytes: 8 * 1024 * 1024,
  depth: 12,
});
export function inventory(root: string) {
  return scanInventory(root, browseLimits);
}
function scanInventory(root: string, limits: InventoryLimits) {
  const files: {
    path: string;
    content: string;
    bytes: number;
    sha256: string;
    language: string;
  }[] = [];
  const omissions: { path: string; reason: string }[] = [];
  /** Where the scan left part of the tree unread, and why. */
  const incomplete: string[] = [];
  let visited = 0,
    bytes = 0,
    exhausted = false;
  const unread = (name: string, reason: string) => {
    omissions.push({ path: name || ".", reason });
    incomplete.push(`${name || "."}: ${reason}`);
  };
  const stop = (name: string, reason: string) => {
    unread(name, reason);
    exhausted = true;
  };
  const walk = (folder: string, depth: number) => {
    if (depth > limits.depth) {
      unread(folder, "Directory depth limit");
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(path.join(root, folder), { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      unread(folder, "Directory unavailable");
      return;
    }
    for (const entry of entries) {
      if (exhausted) return;
      // BaseSeer's own folder in the project is not candidate source. It
      // changes with every scan and build, so it is neither read nor counted
      // as left out, and never consumes traversal limits.
      if (folder === "" && entry.name === ".baseseer") continue;
      if (++visited > limits.entries) {
        stop(folder, `Directory entry limit (${limits.entries})`);
        return;
      }
      if (bytes >= limits.bytes) {
        stop(folder, `Total byte limit (${limits.bytes})`);
        return;
      }
      const name = path.posix.join(folder, entry.name);
      if (privatePath(name)) {
        omissions.push({
          path: name,
          reason: "Excluded private, hidden, dependency or build path",
        });
        continue;
      }
      if (entry.isSymbolicLink()) {
        omissions.push({ path: name, reason: "Links are not followed" });
        continue;
      }
      if (entry.isDirectory()) {
        walk(name, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const language = languages[path.extname(name).slice(1).toLowerCase()];
      if (!language) {
        omissions.push({
          path: name,
          reason: "File format not included in this reader",
        });
        continue;
      }
      try {
        const actual = safePath(root, name);
        // Refuse links inside the tree too, not only links escaping its root.
        if (fs.realpathSync(path.join(root, name)) !== path.resolve(root, name))
          throw Error();
        const buffer = fs.readFileSync(actual);
        if (bytes + buffer.length > limits.bytes) {
          stop(name, `Total byte limit (${limits.bytes})`);
          return;
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer,
        );
        if (content.includes("\0") || secretText(content)) {
          omissions.push({
            path: name,
            reason: "Binary or potentially sensitive content excluded",
          });
          continue;
        }
        bytes += buffer.length;
        files.push({
          path: name,
          content,
          bytes: buffer.length,
          sha256: sha256(buffer),
          language,
        });
      } catch {
        omissions.push({
          path: name,
          reason: "Unavailable, linked, oversized or non-UTF-8 file",
        });
      }
    }
  };
  walk("", 0);
  const digest = sha256(
    JSON.stringify({
      files: files.map((f) => [f.path, f.sha256]),
      omissions: omissions.filter(
        (o) => o.reason !== "Internal BaseSeer checkpoint directory",
      ),
      partial: incomplete.length > 0,
    }),
  );
  return { files, omissions, partial: incomplete.length > 0, incomplete, digest };
}

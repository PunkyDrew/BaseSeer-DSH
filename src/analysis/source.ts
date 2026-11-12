import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlanError, object, text } from "../domain/plan.ts";
import { privatePath, secretText } from "./source-policy.ts";
const relativeMessage = "plan_source only reads inside this project folder. Use a path relative to the project root (for example src or src/app.ts).";
const privateMessage = "Private, hidden, dependency and build paths are excluded from source inspection";
function containedPath(root: string, input: unknown, directory = false) {
  const name = text(input, "relative source path", 200);
  if (path.isAbsolute(name) || path.win32.isAbsolute(name) || name.includes(":") || name.includes("\0"))
    throw new PlanError("DENIED", relativeMessage);
  const base = fs.realpathSync(root);
  const within = (p: string) => {
    const rel = path.relative(base, p);
    return (directory || rel !== "") && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
  };
  const candidate = path.resolve(base, name);
  if (!within(candidate)) throw new PlanError("DENIED", relativeMessage);
  // Check lexical containment before private-path filtering, without revealing excluded paths.
  const normalized = path.relative(base, candidate);
  if (privatePath(name === "." || name === "" ? normalized : name))
    throw new PlanError("DENIED", privateMessage);
  let actual: string;
  try {
    actual = fs.realpathSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new PlanError("UNRESOLVED", `There is no ${name} in the project folder yet.`);
    throw error;
  }
  if (!within(actual)) throw new PlanError("DENIED", relativeMessage);
  if (privatePath(path.relative(base, actual))) throw new PlanError("DENIED", privateMessage);
  return actual;
}
export function safePath(root: string, input: unknown) {
  const actual = containedPath(root, input);
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.nlink > 1 || stat.size > 65536)
    throw new PlanError("DENIED", "Only bounded regular source files with one link");
  return actual;
}
type DirectoryEntry = { name: string; type: "file" | "directory"; size?: number };
type SourceRead = { path: string; sha256: string; content: string; matches: { line: number; text: string }[]; coverage: { status: string; capability: string; gap: string } };
type SourceList = { path: string; entries: DirectoryEntry[]; omitted: number; truncated: boolean };
export function inspectSource(root: string, input: unknown): SourceRead | SourceList {
  const q = object(input, ["path", "query", "mode"]);
  const actual = containedPath(root, q.path, true);
  if (q.mode !== undefined && q.mode !== "read" && q.mode !== "list")
    throw new PlanError("DENIED", "Unknown mode. Use read (default) or list.");
  if (q.mode === "list") {
    if (!fs.statSync(actual).isDirectory()) throw new PlanError("DENIED", "Only directories can be listed");
    const entries: { name: string; type: "file" | "directory"; size?: number }[] = [];
    let omitted = 0;
    for (const entry of fs.readdirSync(actual, { withFileTypes: true })) {
      try {
        const relative = path.relative(fs.realpathSync(root), path.join(actual, entry.name));
        const target = containedPath(root, relative, true);
        const stat = fs.statSync(target);
        if (stat.isDirectory()) entries.push({ name: entry.name, type: "directory" });
        else if (stat.isFile()) entries.push({ name: entry.name, type: "file", size: stat.size });
        else omitted++;
      } catch { omitted++; }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
    return { path: text(q.path, "path"), entries: entries.slice(0, 500), omitted, truncated: entries.length > 500 };
  }
  const file = safePath(root, q.path), content = fs.readFileSync(file, "utf8");
  if (secretText(content)) throw new PlanError("DENIED", "Potentially sensitive source content is excluded");
  const query = q.query === undefined ? undefined : text(q.query, "literal query", 100);
  return {
    path: text(q.path, "path"),
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
    matches: query === undefined ? [] : content.split(/\r?\n/).flatMap((line, i) => line.includes(query) ? [{ line: i + 1, text: line }] : []),
    coverage: { status: "partial", capability: "bounded text read/literal search", gap: "Stage 0 does not perform semantic language analysis or execute project configuration" },
  };
}

import type {
  ProjectSnapshot,
  ScanProgress,
} from "../contracts/project-map.ts";
import fs from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { languages, sha256 } from "./code-inventory.ts";
import { privatePath, secretText } from "./source-policy.ts";
import { analyze } from "./language-runner.ts";
import { analysisVersion, type AnalysisInput } from "./language-types.ts";
import { gitContextAsync, observationDigest } from "./git-context.ts";
import { PlanError } from "../domain/plan.ts";
import type { CodeSnapshot, CodeFile } from "../contracts/code.ts";

export const projectLimits = {
  files: 1500,
  fileBytes: 512 * 1024,
  totalBytes: 32 * 1024 * 1024,
  entries: 20000,
  depth: 20,
};
export function scanScope(root: string, input = "") {
  if (
    typeof input !== "string" ||
    input.length > 200 ||
    input.includes("\\") ||
    input.includes(":") ||
    input.includes("\0") ||
    path.posix.isAbsolute(input) ||
    input.split("/").some((p) => p === ".." || p === ".")
  )
    throw new PlanError(
      "DENIED",
      "Choose a relative project folder without parent segments.",
    );
  const scope = input.replace(/\/$/, "");
  if (scope && privatePath(scope))
    throw new PlanError("DENIED", "This folder is excluded from inspection.");
  const base = fs.realpathSync(root),
    target = path.resolve(base, scope);
  if (fs.realpathSync(target) !== target || !fs.statSync(target).isDirectory())
    throw new PlanError(
      "DENIED",
      "Choose a regular folder inside this project; links are not followed.",
    );
  return { base, scope };
}
export function readProjectFile(root: string, name: string) {
  if (
    typeof name !== "string" ||
    name.length > 400 ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    name.split("/").some((p) => !p || p === "." || p === "..") ||
    privatePath(name)
  )
    throw new PlanError(
      "DENIED",
      "Only inspected relative source files can be read.",
    );
  const base = fs.realpathSync(root),
    candidate = path.resolve(base, name);
  if (fs.realpathSync(candidate) !== candidate)
    throw new PlanError("DENIED", "Links are not followed.");
  const fd = fs.openSync(
    candidate,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > projectLimits.fileBytes
    )
      throw new PlanError(
        "DENIED",
        "File is unavailable, linked or larger than 512 KiB.",
      );
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0,
      n = 0;
    while (
      length < buffer.length &&
      (n = fs.readSync(fd, buffer, length, buffer.length - length, null))
    )
      length += n;
    if (length > stat.size)
      throw new PlanError(
        "STALE",
        "File changed while being read; scan again.",
      );
    const bytes = buffer.subarray(0, length);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0") || secretText(content))
      throw new PlanError(
        "DENIED",
        "Binary or potentially sensitive content excluded.",
      );
    return { content, bytes: length, sha256: sha256(bytes) };
  } finally {
    fs.closeSync(fd);
  }
}
function configurationFileHash(root: string, relative: string) {
  try {
    return readProjectFile(root, relative).sha256;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "absent"
      : "unavailable";
  }
}
export function configurationContext(root: string, scope = "") {
  const parents = new Set([""]);
  let current = scope;
  while (current) {
    parents.add(current);
    const next = path.posix.dirname(current);
    current = next === "." ? "" : next;
  }
  return [...parents]
    .flatMap((folder) =>
      ["package.json", "tsconfig.json", "jsconfig.json"].map((name) => {
        const relative = path.posix.join(folder, name);
        return {
          path: relative,
          sha256: configurationFileHash(root, relative),
        };
      }),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}
export function configurationCurrent(
  root: string,
  configuration: { path: string; sha256: string }[],
) {
  return configuration.every(
    (c) => configurationFileHash(root, c.path) === c.sha256,
  );
}
export async function scanProject(
  root: string,
  scope = "",
  options: {
    signal?: AbortSignal;
    progress?: (p: ScanProgress) => void;
    limits?: Partial<typeof projectLimits>;
    analysisTimeoutMs?: number;
  } = {},
): Promise<ProjectSnapshot> {
  const checked = scanScope(root, scope),
    limits = { ...projectLimits, ...options.limits };
  const files: (CodeFile & { content?: string })[] = [],
    omissions: CodeSnapshot["omissions"] = [];
  const progress: ScanProgress = {
    phase: "reading",
    visited: 0,
    files: 0,
    bytes: 0,
    path: checked.scope || ".",
  };
  let partial = false,
    stopped = false;
  const candidates: string[] = [];
  const pending = [{ folder: checked.scope, depth: 0 }];
  const git = await gitContextAsync(checked.base, options.signal);
  const configuration = configurationContext(checked.base, checked.scope);
  const tick = async () => {
    options.signal?.throwIfAborted();
    options.progress?.({ ...progress });
    await setImmediate();
    options.signal?.throwIfAborted();
  };
  const omit = (name: string, reason: string, incomplete = false) => {
    omissions.push({ path: name || ".", reason });
    if (incomplete) partial = true;
  };
  const walk = async (folder: string, depth: number) => {
    if (stopped) return;
    if (depth > limits.depth) {
      omit(folder, "Directory depth limit reached", true);
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      const dir = fs.opendirSync(path.join(checked.base, folder));
      try {
        let entry;
        while ((entry = dir.readSync())) {
          if (entries.length + progress.visited >= limits.entries) {
            omit(
              folder,
              "Entry limit reached; directory listing is partial",
              true,
            );
            stopped = true;
            break;
          }
          entries.push(entry);
        }
      } finally {
        dir.closeSync();
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      omit(folder, "Directory unavailable", true);
      return;
    }
    for (const entry of entries) {
      if (progress.visited >= limits.entries) {
        omit(
          folder,
          "Scan limit reached; narrow the scan folder to inspect more",
          true,
        );
        stopped = true;
        return;
      }
      // BaseSeer's own folder in the project is not the project's source. It
      // changes with every scan and build, so it is neither read nor counted
      // as left out; an omission would be part of the scan digest.
      if (folder === "" && entry.name === ".baseseer") continue;
      ++progress.visited;
      const name = path.posix.join(folder, entry.name);
      progress.path = name;
      if (progress.visited % 24 === 0) await tick();
      if (
        privatePath(name) ||
        /(^|\/)(venv|__pycache__|site-packages|bower_components)(\/|$)/i.test(
          name,
        )
      ) {
        omit(name, "Excluded private, hidden, dependency or build path");
        continue;
      }
      if (entry.isSymbolicLink()) {
        omit(
          name,
          "Link not followed; open its actual folder as a separate project",
          true,
        );
        continue;
      }
      if (entry.isDirectory()) {
        pending.push({ folder: name, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) {
        omit(name, "Not a regular file");
        continue;
      }
      const extension = path.extname(name).slice(1).toLowerCase();
      if (
        /^(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|docx?|xlsx?|pptx?|zip|gz|bz2|xz|7z|rar|tar|exe|dll|so|dylib|bin|wasm|woff2?|ttf|otf|mp[34]|m4[av]|mov|mkv|wav|ogg|flac|aac|webm|zstd|zst)$/i.test(
          extension,
        )
      ) {
        omit(
          name,
          "Binary, media or archive format; extract or open its source separately",
        );
        continue;
      }
      candidates.push(name);
    }
  };
  await tick();
  for (let i = 0; i < pending.length && !stopped; i++)
    await walk(pending[i].folder, pending[i].depth);
  if (stopped)
    omit(
      checked.scope,
      "Entry limit reached before all folders could be visited. Narrow the scan folder for coverage of omitted areas.",
      true,
    );
  const priority = (name: string) =>
    /\.(?:[cm]?[jt]sx?|py|rs|pas|pp|dpr|lpr|dpk|inc|ads|adb|ada|gpr|adc|f|for|f77|f90|f95|f03|f08|f18|f23|m|mm|[ch]|cpp|hpp|cs|go|java|lua|rockspec|rb|rake|gemspec|php|phtml|php[0-9]|swift|kt|sql|html|css|ps1|sh|vue|svelte|dart|asm|nasm|s|zig|ex|exs|scala|groovy|r)$/i.test(
      name,
    )
      ? 0
      : /(^|\/)(readme|agents)\.md$/i.test(name)
        ? 1
        : 2;
  candidates.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.split("/").length - b.split("/").length ||
      a.localeCompare(b),
  );
  for (let i = 0; i < candidates.length; i++) {
    const name = candidates[i],
      extension = path.extname(name).slice(1).toLowerCase();
    progress.path = name;
    if (i % 16 === 0) await tick();
    if (files.length >= limits.files || progress.bytes >= limits.totalBytes) {
      omit(
        checked.scope,
        `Scan limit reached; ${candidates.length - i} discovered text candidates not read. Narrow the scan folder.`,
        true,
      );
      break;
    }
    const language =
      languages[extension] ?? (extension ? `Text (.${extension})` : "Text");
    try {
      const value = readProjectFile(checked.base, name);
      if (progress.bytes + value.bytes > limits.totalBytes) {
        omit(name, "Total byte limit reached; narrow the scan folder", true);
        continue;
      }
      progress.bytes += value.bytes;
      files.push({
        path: name,
        ...value,
        language,
        lines: value.content.split(/\r?\n/).length,
        declarations: [],
        imports: [],
        coverage: "unsupported",
      });
      progress.files = files.length;
    } catch (error) {
      omit(
        name,
        error instanceof PlanError
          ? error.message
          : "Unavailable or non-UTF-8 file",
        true,
      );
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  progress.phase = "analyzing";
  progress.path = checked.scope || ".";
  await tick();
  const analyzed = await analyze(
    {
      files: files as (CodeFile & { content: string })[],
      configuration,
    },
    { signal: options.signal, timeoutMs: options.analysisTimeoutMs },
  );
  files.splice(0, files.length, ...analyzed.files);
  await tick();
  for (const file of files) {
    if (readProjectFile(checked.base, file.path).sha256 !== file.sha256)
      throw new PlanError(
        "STALE",
        "Source changed during language analysis. Scan again.",
      );
  }
  const endGit = await gitContextAsync(checked.base, options.signal);
  if (!configurationCurrent(checked.base, configuration))
    throw new PlanError(
      "STALE",
      "Project configuration changed during analysis. Scan again.",
    );
  if (JSON.stringify(git) !== JSON.stringify(endGit))
    throw new PlanError(
      "STALE",
      "Git context changed during the scan. Scan again.",
    );
  const result: ProjectSnapshot = {
    digest: sha256(
      JSON.stringify({
        scope: checked.scope,
        files: files.map((f) => [f.path, f.sha256]),
        omissions,
        partial,
        analysis: analyzed.analysis.fingerprint,
      }),
    ),
    git,
    checkedAt: new Date().toISOString(),
    analyzer: analysisVersion,
    analysis: analyzed.analysis,
    files,
    omissions,
    partial,
    scope: checked.scope,
    context: "",
    progress,
    limits: [
      "Read-only working-file observations. Project scripts, configuration plugins and application code are never executed. A scan is not an atomic filesystem snapshot; files may change while scanning. Refresh after transfers or edits finish.",
      "JavaScript / TypeScript: compiler scopes, declarations, conventional local imports and static declaration references. HTML, CSS and Markdown: document resource references. package.json: declared entry points and dependencies. See per-file capabilities and unresolved relationships; these are not runtime execution or a whole-program call graph.",
      "Other languages and unfamiliar file extensions: bounded UTF-8 source reading only. Common binary, media and archive formats are excluded. Project configuration is fingerprinted, not executed; unsupported aliases, loaders, build context and dynamic dispatch remain gaps.",
      "Language analysis runs on demand in an isolated 256 MiB Node worker, bounded to 25 seconds, 8 MiB per adapter, 60,000 facts and 24 MiB output. Missing tools and limits never count as successful analysis.",
      "Hidden/private paths, dependencies, build folders, links and suspicious content are excluded. Git ignore rules are not evaluated. Inspect exclusions; a readable inventory is not proof of a complete project or absence of secrets.",
      "At most 1,500 files, 512 KiB per file, 32 MiB total, 20,000 entries and 20 directory levels. Folders are discovered breadth-first; common source formats are read before documentation and data. Narrow the scan folder for larger projects. Out-of-scope dependencies are unresolved. Git context covers the opened root repository, not nested repositories.",
    ],
  };
  result.context = observationDigest(result);
  return result;
}

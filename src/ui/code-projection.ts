import type { CodeFile, CodeSnapshot } from "../contracts/code.ts";
import type { LevelPath } from "./notations/levels.ts";

// The code map opens level by level, like the Plan's pictures: a level shows
// the files directly in one folder, and each folder inside it as a closed box
// that says how many files it holds. Opening a folder shows its own level.

/** A box on the map: a file, or a closed folder whose `group` says what it holds. */
export type ProjectedFile = CodeFile & {
  group?: { path: string; count: number; internalImports: number };
};
/** A file or folder a search can jump to, with the folders above it. */
export type CodePart = { id: string; title: string; path: string; where: string };

export const codeMapTitle = "Code map";
const folderPrefix = "folder:";

/** What a closed folder says about itself. */
export const holds = (count: number) => `holds ${count} ${count === 1 ? "file" : "files"}`;
/** The id of a folder's box; a file's box is its path. */
export const folderId = (path: string) => folderPrefix + path;
/** The folder a box id stands for, or null for a file. */
export const folderPath = (id: string) =>
  id.startsWith(folderPrefix) ? id.slice(folderPrefix.length) : null;
/** The folder one level up; "" is the top. */
export const parentFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

const within = (path: string, level: string) => !level || path.startsWith(level + "/");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The box a file appears as on a level: itself, or the closed folder directly below holding it. */
function boxOf(path: string, level: string) {
  const rest = level ? path.slice(level.length + 1) : path;
  const slash = rest.indexOf("/");
  if (slash < 0) return path;
  return folderId(level ? `${level}/${rest.slice(0, slash)}` : rest.slice(0, slash));
}

function closedFolder(id: string): ProjectedFile {
  return {
    path: id,
    sha256: "",
    language: "Folder",
    lines: 0,
    bytes: 0,
    declarations: [],
    imports: [],
    coverage: "unsupported",
    group: { path: folderPath(id)!, count: 0, internalImports: 0 },
  };
}

/**
 * The boxes of one level. An import between two files becomes an import
 * between their boxes, once per kind; one inside a folder is counted on it.
 */
export function projectLevel(snapshot: CodeSnapshot, level: string) {
  const visible = snapshot.files.filter((file) => within(file.path, level));
  const boxIds = new Map(visible.map((file) => [file.path, boxOf(file.path, level)]));
  const boxes = new Map<string, ProjectedFile>();
  for (const file of visible) {
    const id = boxIds.get(file.path)!;
    const box = boxes.get(id) ?? (id === file.path ? { ...file, imports: [] } : closedFolder(id));
    boxes.set(id, box);
    if (box.group) box.group.count++;
    for (const observed of file.imports) {
      const target = observed.target && boxIds.get(observed.target);
      if (!target) continue;
      if (target === id) {
        if (box.group) box.group.internalImports++;
        continue;
      }
      if (!box.imports.some((seen) => seen.target === target && seen.kind === observed.kind))
        box.imports.push({ ...observed, target });
    }
  }
  return { files: [...boxes.values()], total: visible.length };
}

/** The level while files remain in it, else the nearest folder above that has some. */
export function nearestFolder(snapshot: CodeSnapshot, level: string) {
  let open = level;
  while (open && !snapshot.files.some((file) => file.path.startsWith(open + "/")))
    open = parentFolder(open);
  return open;
}

/** Whether the snapshot still holds the file or folder a box id stands for. */
export function hasPart(snapshot: CodeSnapshot, id: string) {
  const folder = folderPath(id);
  if (folder === null) return snapshot.files.some((file) => file.path === id);
  return snapshot.files.some((file) => file.path.startsWith(folder + "/"));
}

/** The breadcrumb to a level: each folder from the top down, the open one last. */
export function levelPath(level: string): LevelPath {
  if (!level) return [];
  const names = level.split("/");
  return names.map((title, index) => ({ id: names.slice(0, index + 1).join("/"), title }));
}

/** Every file and folder of the snapshot, for searching. */
export function codeParts(snapshot: CodeSnapshot): CodePart[] {
  const folders = new Set<string>();
  for (const file of snapshot.files)
    for (let folder = parentFolder(file.path); folder; folder = parentFolder(folder))
      folders.add(folder);
  const part = (id: string, path: string) => ({
    id,
    path,
    title: nameOf(path),
    where: [codeMapTitle, ...levelPath(parentFolder(path)).map((step) => step.title)].join(" › "),
  });
  return [
    ...[...folders].map((folder) => part(folderId(folder), folder)),
    ...snapshot.files.map((file) => part(file.path, file.path)),
  ];
}

const matchLimit = 100;

/** Parts whose name contains the query, those whose name starts with it first. */
export function findParts(parts: readonly CodePart[], query: string) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  const starts = (part: CodePart) => (part.title.toLowerCase().startsWith(wanted) ? 0 : 1);
  return parts
    .filter((part) => part.title.toLowerCase().includes(wanted))
    .sort((a, b) => starts(a) - starts(b))
    .slice(0, matchLimit);
}

/** Where a found part is drawn: the folder holding it, and the part itself chosen there. */
export function partLocation(id: string) {
  return { level: parentFolder(folderPath(id) ?? id), selected: id };
}

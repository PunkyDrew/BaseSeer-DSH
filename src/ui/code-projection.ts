import type { CodeFile, CodeSnapshot } from "../contracts/code.ts";
export type ProjectedFile = CodeFile & {
  group?: { path: string; count: number; internalImports: number };
};
// Folder boxes summarize observed import statements. They are not inferred components.
export function projectCodeGraph(
  snapshot: CodeSnapshot,
  folder: string,
  grouped = false,
) {
  const visible = snapshot.files.filter(
    (f) => !folder || f.path.startsWith(folder + "/"),
  );
  if (!grouped || visible.length <= 80)
    return {
      files: visible as ProjectedFile[],
      omitted: 0,
      total: visible.length,
    };
  const groups = new Map<string, ProjectedFile>(),
    membership = new Map<string, string>();
  for (const file of visible) {
    const rest = folder ? file.path.slice(folder.length + 1) : file.path;
    const group = rest.includes("/")
      ? [folder, rest.split("/")[0]].filter(Boolean).join("/")
      : "";
    const id = group ? `folder:${group}` : file.path;
    membership.set(file.path, id);
    if (!group) {
      groups.set(id, { ...file, imports: [] });
      continue;
    }
    const item = groups.get(id) ?? {
      path: id,
      language: "Folder",
      sha256: "",
      lines: 0,
      bytes: 0,
      declarations: [],
      imports: [],
      coverage: "unsupported",
      group: { path: group, count: 0, internalImports: 0 },
    };
    ++item.group!.count;
    item.lines += file.lines;
    item.bytes += file.bytes;
    groups.set(id, item);
  }
  const files = [...groups.values()].slice(0, 80),
    included = new Set(files.map((f) => f.path));
  for (const file of visible) {
    const from = membership.get(file.path)!;
    if (!included.has(from)) continue;
    const node = groups.get(from)!;
    for (const dependency of file.imports) {
      const to = dependency.target && membership.get(dependency.target);
      if (from === to && node.group) ++node.group.internalImports;
      if (!to || from === to || !included.has(to)) continue;
      if (
        !node.imports.some((i) => i.target === to && i.kind === dependency.kind)
      )
        node.imports.push({ ...dependency, target: to });
    }
  }
  return { files, omitted: groups.size - files.length, total: visible.length };
}

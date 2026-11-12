import { plainOutput } from "./commands.ts";

// The project files a failed command's output points at, so BaseSeer can send
// the failure to the subagent whose work they are. Test runners list the files
// that passed as well as the one that failed, so only the lines that do not
// report a pass say whose work the failure is.

/** A line reporting that something passed: runners mark each passing file or test. */
const PASSED = /[✓✔√]|\bPASS(ED)?\b|^\s*ok\b/;
/** A test's own console output, which a runner echoes whether the test passes or not. */
const ECHOED = /^\s*(stdout|stderr)\s*\|/;
/** A character a path can hold before a file's name: a match after one is part of a longer name. */
const BEFORE_NAME = /[\w.@-]/;
/** A character a path can hold after a file's name. */
const AFTER_NAME = /[\w@-]/;

type Match = { file: string; start: number; end: number };

/** Whether the text before a match belongs to an installed package's path rather than the project's. */
function inPackages(line: string, start: number) {
  const token = line.slice(0, start).split(/[\s"'`(<[]/).at(-1) ?? "";
  return token.includes("node_modules/");
}

/** Every place on the line where one of the files is named as a whole name. */
function matchesOn(line: string, files: string[]) {
  const found: Match[] = [];
  for (const file of files)
    for (let at = line.indexOf(file); at >= 0; at = line.indexOf(file, at + 1)) {
      const end = at + file.length;
      if (BEFORE_NAME.test(line[at - 1] ?? "")) continue;
      if (AFTER_NAME.test(line[end] ?? "")) continue;
      if (inPackages(line, at)) continue;
      found.push({ file, start: at, end });
    }
  return found;
}

/** A match inside a longer one names the longer file: src/app.ts, not a root app.ts. */
const withinLonger = (match: Match, all: Match[]) =>
  all.some(
    (other) =>
      other.start <= match.start &&
      other.end >= match.end &&
      other.end - other.start > match.end - match.start,
  );

/**
 * The project files the output names on lines that do not report a pass,
 * such as the failing test, the file a type error is in or a stack frame of
 * the failure. `files` are the project's files, relative to its folder. The
 * colour codes test runners write are removed first: a runner can colour a
 * file's folder and its name apart.
 */
export function filesNamedIn(output: string, files: string[]) {
  const named = new Set<string>();
  for (const line of plainOutput(output).replaceAll("\\", "/").split(/\r?\n/)) {
    if (PASSED.test(line) || ECHOED.test(line)) continue;
    const matches = matchesOn(line, files);
    for (const match of matches)
      if (!withinLonger(match, matches)) named.add(match.file);
  }
  return [...named].sort();
}

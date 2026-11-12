import { builtComponents } from "../../domain/build-plan.ts";
import type { Document } from "../../domain/records.ts";
import type { BuildCommands } from "./model.ts";

// BaseSeer writes two of the README's sections itself: the commands, from
// the ones the build recorded and the acceptance check runs, and where each
// part of the code lives, from the plan's components and their files. A
// subagent asked to document them lists only the targeted runs it used, and
// leaves the code's layout as the first build had it.

const WHAT_EACH_DOES: [keyof BuildCommands, string][] = [
  ["install", "Install the dependencies"],
  ["build", "Build"],
  ["test", "Run the unit tests"],
  ["e2e", "Run the end-to-end tests"],
  ["lint", "Lint the code"],
];

const NEXT_HEADING = /^#{1,2}\s/m;

/** The README with the section under `heading` written as `body`, in place of any it had. */
function withSection(readme: string | undefined, project: string, heading: string, body: string) {
  const section = `## ${heading}\n\n${body}\n`;
  if (!readme) return `# ${project}\n\n${section}`;
  const found = readme.match(new RegExp(`^##\\s+${heading}\\s*$`, "im"));
  if (found?.index === undefined) return `${readme.trimEnd()}\n\n${section}`;
  const after = readme.slice(found.index + found[0].length);
  const next = after.search(NEXT_HEADING);
  const rest = next >= 0 ? `\n${after.slice(next)}` : "";
  return `${readme.slice(0, found.index)}${section}${rest}`;
}

/** The README with its Commands section written from the recorded commands. */
export function withCommands(
  readme: string | undefined,
  project: string,
  commands: BuildCommands,
) {
  const lines = WHAT_EACH_DOES.filter(([name]) => commands[name]).map(
    ([name, what]) => `- ${what}: \`${commands[name]}\``,
  );
  return withSection(readme, project, "Commands", `Run each from the project folder.\n\n${lines.join("\n")}`);
}

/** The README with its Code section written from the plan: each part of the project and its files. */
export function withCode(readme: string | undefined, project: string, doc: Document) {
  const parts = builtComponents(doc).map((c) => {
    const files: string[] = c.data.contract?.sourceTargets ?? [];
    const what = c.data.responsibility ? `: ${c.data.responsibility}` : "";
    return `- ${c.title}${what} (${files.map((f) => `\`${f}\``).join(", ")})`;
  });
  return withSection(readme, project, "Code", `Where each part of the project lives.\n\n${parts.join("\n")}`);
}

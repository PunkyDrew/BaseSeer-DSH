import fs from "node:fs";
import path from "node:path";
import { json, objectValue } from "./json.ts";
import { writeFileAtomically } from "./project-folder.ts";

// BaseSeer's own data folder holds the little that is not about one project:
// the owner's pricing setting and which DSH sessions are planning sessions in
// which workspace. Each is one small JSON file.

type PricingSettings = { revision: number; blockPeak: boolean };

function pricingSettings(input: unknown): PricingSettings {
  const value = objectValue(input);
  if (!Number.isSafeInteger(value.revision) || typeof value.blockPeak !== "boolean")
    throw Error("Invalid pricing settings");
  return { revision: value.revision, blockPeak: value.blockPeak };
}

function sessionMap(input: unknown): Record<string, string> {
  const value = objectValue(input);
  for (const workspace of Object.values(value))
    if (typeof workspace !== "string") throw Error("Invalid planning session");
  return value as Record<string, string>;
}

export class DataFolder {
  readonly folder: string;
  constructor(folder: string) {
    this.folder = folder;
    fs.mkdirSync(folder, { recursive: true });
  }
  private read<T>(name: string, label: string, validate: (input: unknown) => T): T | undefined {
    const file = path.join(this.folder, name);
    if (!fs.existsSync(file)) return undefined;
    return json(fs.readFileSync(file, "utf8"), label, validate);
  }
  private write(name: string, value: unknown) {
    writeFileAtomically(path.join(this.folder, name), JSON.stringify(value, null, 2) + "\n");
  }

  /** The owner's choice to block DeepSeek requests at peak prices, with a revision for safe edits. */
  readonly pricing = {
    read: (): PricingSettings =>
      this.read("pricing.json", "pricing settings", pricingSettings) ?? {
        revision: 0,
        blockPeak: false,
      },
    save: (blockPeak: boolean, expected: number): boolean => {
      const current = this.pricing.read();
      if (current.revision !== expected) return false;
      this.write("pricing.json", { revision: expected + 1, blockPeak });
      return true;
    },
  };

  /** Which DSH sessions are planning sessions, and in which workspace. */
  readonly sessions = {
    read: (): Record<string, string> =>
      this.read("planning-sessions.json", "planning sessions", sessionMap) ?? {},
    session: (session: string, workspace?: string): { workspace: string } | undefined => {
      const found = this.sessions.read()[session];
      if (found === undefined || (workspace !== undefined && found !== workspace))
        return undefined;
      return { workspace: found };
    },
    enroll: (session: string, workspace: string) => {
      this.write("planning-sessions.json", { ...this.sessions.read(), [session]: workspace });
    },
    unenroll: (session: string) => {
      const { [session]: _gone, ...rest } = this.sessions.read();
      this.write("planning-sessions.json", rest);
    },
  };
}

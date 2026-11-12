import fs from "node:fs";
import path from "node:path";
import { json } from "./json.ts";
import { writeFileAtomically } from "./project-folder.ts";

/**
 * This machine's files about one project, under `.baseseer/local`: each is a
 * JSON document or a log of JSON lines, read with its own validation, and a
 * missing file means nothing was recorded.
 */
export class LocalFiles {
  readonly folder: string;
  constructor(folder: string) {
    this.folder = folder;
  }
  private file(name: string) {
    return path.join(this.folder, name);
  }
  read<T>(name: string, label: string, validate: (input: unknown) => T): T | undefined {
    let text: string;
    try {
      text = fs.readFileSync(this.file(name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return json(text, label, validate);
  }
  write(name: string, value: unknown) {
    writeFileAtomically(this.file(name), JSON.stringify(value, null, 2) + "\n");
  }
  /** The names of the files in a subfolder, without their `.json` ending. */
  names(subfolder: string): string[] {
    try {
      return fs
        .readdirSync(this.file(subfolder))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  append(name: string, value: unknown) {
    fs.mkdirSync(this.folder, { recursive: true });
    fs.appendFileSync(this.file(name), JSON.stringify(value) + "\n");
  }
  lines<T>(name: string, label: string, validate: (input: unknown) => T): T[] {
    let text: string;
    try {
      text = fs.readFileSync(this.file(name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => json(line, label, validate));
  }
}

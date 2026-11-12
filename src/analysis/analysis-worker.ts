import fs from "node:fs";
import { analyzeLanguages } from "./language-registry.ts";
// Executed by our bounded runner, with no project filesystem or network access requested.
const input = fs.readFileSync(0, "utf8");
if (Buffer.byteLength(input) > 40 * 1024 * 1024)
  throw new Error("Analysis input limit");
process.stdout.write(JSON.stringify(analyzeLanguages(JSON.parse(input))));

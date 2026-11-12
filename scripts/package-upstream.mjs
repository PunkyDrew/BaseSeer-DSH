import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Offline assembly only. Never execute or extract upstream build scripts.
const root = path.resolve(import.meta.dirname, "..");
if (!process.argv[2])
  throw Error(
    "Usage: node scripts/package-upstream.mjs UPSTREAM_MATERIALS_DIRECTORY [OUTPUT_DIRECTORY]",
  );
const materials = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] ?? ".local/packages");
const inventory = JSON.parse(
  fs.readFileSync(path.join(root, "third-party/upstream-sources.json")),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, "dsh-baseseer-upstream-0.12.0-r4.tar.gz");
if (fs.existsSync(archive) || fs.existsSync(archive + ".json"))
  throw Error("Source companion already exists");
const stage = fs.mkdtempSync(path.join(output, "upstream-stage-"));
const names = new Set();
for (const item of inventory.items) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(item.file) || names.has(item.file))
    throw Error("Unsafe source inventory");
  names.add(item.file);
  const bytes = fs.readFileSync(path.join(materials, item.file));
  if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
    throw Error("Source material digest mismatch: " + item.file);
  fs.writeFileSync(path.join(stage, item.file), bytes, { flag: "wx" });
}
for (const file of [
  "upstream-sources.json",
  "UPSTREAM_SOURCES.md",
  "UPSTREAM_NOTICES.txt",
]) {
  names.add(file);
  fs.copyFileSync(path.join(root, "third-party", file), path.join(stage, file));
}
const temporary = path.join(stage, "companion.tar.gz");
execFileSync(
  "tar",
  ["--format=ustar", "-czf", temporary, "-C", stage, ...[...names].sort()],
  { windowsHide: true },
);
fs.copyFileSync(temporary, archive, fs.constants.COPYFILE_EXCL);
const report = {
  archive: path.basename(archive),
  sha256: digest(fs.readFileSync(archive)),
  materials: inventory.items.length,
  files: [...names].sort(),
  publicationAuthorized: false,
};
fs.writeFileSync(archive + ".json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify(report));

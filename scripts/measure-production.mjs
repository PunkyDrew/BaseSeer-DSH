import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Installed-footprint rule. Installed bytes are the regular files a
// private package places under node_modules/dsh-baseseer; the compressed
// archive size is reported separately and is not the gate.
export const FOOTPRINT_LIMIT = 30_000_000;
export const AREA_BUDGETS = {
  typescript: 10_500_000,
  ownNode: 2_500_000,
  otherNode: 1_000_000,
  client: 4_600_000,
  metadata: 600_000,
};
export const MIN_HEADROOM = 8_000_000;

const nodeBundle = (name) =>
  name.startsWith("dist/") && name !== "dist/client.js";

// Package owning a bundler input, or null for the project's own source.
export function inputPackage(input) {
  const parts = input.replaceAll("\\", "/").split("/");
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return null;
  const first = parts[at + 1];
  return first?.startsWith("@") ? `${first}/${parts[at + 2]}` : first;
}

// files: { name: bytes }. bundles: { "dist/x.js": esbuild metafile } for
// bundled outputs. vendors: { "dist/x": packageName } for copied vendor files.
export function measureFootprint({ files, bundles = {}, vendors = {} }) {
  const installed = Object.values(files).reduce((a, b) => a + b, 0);
  const areas = {
    typescript: 0,
    ownNode: 0,
    otherNode: 0,
    client: 0,
    metadata: 0,
  };
  const attribution = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name === "dist/client.js") {
      areas.client += bytes;
      continue;
    }
    if (!nodeBundle(name)) {
      areas.metadata += bytes;
      continue;
    }
    if (vendors[name]) {
      const area = vendors[name] === "typescript" ? "typescript" : "otherNode";
      areas[area] += bytes;
      attribution[name] = { [vendors[name]]: bytes };
      continue;
    }
    const metafile = bundles[name];
    if (!metafile) {
      // Unattributed node output counts as own code so it is never hidden.
      areas.ownNode += bytes;
      attribution[name] = { unattributed: bytes };
      continue;
    }
    const output = Object.entries(metafile.outputs).find(([out]) =>
      out.replaceAll("\\", "/").endsWith(name),
    )?.[1];
    const byOwner = {};
    let attributed = 0;
    for (const [input, { bytesInOutput }] of Object.entries(
      output?.inputs ?? {},
    )) {
      const owner = inputPackage(input) ?? "(own)";
      byOwner[owner] = (byOwner[owner] ?? 0) + bytesInOutput;
      attributed += bytesInOutput;
    }
    // Bundler runtime, banners and wrappers are part of our own output.
    byOwner["(own)"] = (byOwner["(own)"] ?? 0) + Math.max(0, bytes - attributed);
    for (const [owner, value] of Object.entries(byOwner))
      areas[
        owner === "(own)"
          ? "ownNode"
          : owner === "typescript"
            ? "typescript"
            : "otherNode"
      ] += value;
    attribution[name] = Object.fromEntries(
      Object.entries(byOwner).sort(([, a], [, b]) => b - a),
    );
  }
  const failures = [];
  if (!(installed < FOOTPRINT_LIMIT))
    failures.push(
      `Installed footprint ${installed} is not under ${FOOTPRINT_LIMIT}`,
    );
  for (const [area, budget] of Object.entries(AREA_BUDGETS))
    if (areas[area] > budget)
      failures.push(`${area} uses ${areas[area]} of a ${budget} budget`);
  const headroom = FOOTPRINT_LIMIT - installed;
  if (headroom < MIN_HEADROOM)
    failures.push(`Headroom ${headroom} is below ${MIN_HEADROOM}`);
  return {
    rule: "c124-installed-footprint-v1",
    limit: FOOTPRINT_LIMIT,
    installed,
    headroom,
    areas,
    budgets: AREA_BUDGETS,
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
    ),
    attribution,
    passed: failures.length === 0,
    failures,
  };
}

export function folderFiles(folder) {
  return Object.fromEntries(
    fs
      .readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = path.join(entry.parentPath, entry.name);
        return [
          path.relative(folder, full).replaceAll("\\", "/"),
          fs.statSync(full).size,
        ];
      }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  // Usage: node scripts/measure-production.mjs <staged package folder>
  // Without bundle metafiles every node output is reported as unattributed.
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(path.join(folder, "package.json")))
    throw new Error(
      "Usage: node scripts/measure-production.mjs <staged package folder>",
    );
  const report = measureFootprint({ files: folderFiles(folder) });
  delete report.attribution;
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

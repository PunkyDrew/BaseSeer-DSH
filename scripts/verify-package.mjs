import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { releaseFiles, privateVersion } from "./release-files.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const text = (bytes) => bytes.toString("utf8").replace(/\0.*$/s, "");
const octal = (bytes) => {
  const value = text(bytes).trim();
  requireThat(/^[0-7]+$/.test(value), "Unsupported tar numeric field");
  return Number.parseInt(value, 8);
};

// Reads a bounded USTAR distribution without extracting or executing anything.
// Extended headers, links and special files are deliberately outside this format.
export function readPackage(bytes) {
  requireThat(
    bytes.length <= 32 * 1024 * 1024,
    "Compressed package is too large",
  );
  const data = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  requireThat(data.length % 512 === 0, "Invalid tar block length");
  const files = new Map(),
    seen = new Set();
  const allowed = new Set(releaseFiles.map((name) => `package/${name}`));
  allowed.add("package/integrity.json");
  let offset = 0,
    ended = false;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      requireThat(
        data.length - offset >= 1024 &&
          data.subarray(offset).every((byte) => byte === 0),
        "Invalid tar end marker",
      );
      ended = true;
      break;
    }
    requireThat(
      text(header.subarray(257, 263)) === "ustar",
      "Expected USTAR package",
    );
    const checksum = [...header].reduce(
      (sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte),
      0,
    );
    requireThat(
      checksum === octal(header.subarray(148, 156)),
      "Tar header checksum mismatch",
    );
    const name = text(header.subarray(0, 100));
    requireThat(
      text(header.subarray(345, 500)) === "",
      "Tar prefixes are not supported",
    );
    requireThat(!seen.has(name), "Duplicate package member");
    seen.add(name);
    const type = header[156],
      size = octal(header.subarray(124, 136));
    requireThat(
      header.subarray(157, 257).every((byte) => byte === 0),
      "Tar link target is forbidden",
    );
    const directory = type === 53;
    requireThat(
      directory || type === 48 || type === 0,
      "Links and extended/special tar entries are forbidden",
    );
    requireThat(
      directory
        ? [
            "package/",
            "package/dist/",
          ].includes(name) && size === 0
        : allowed.has(name),
      "Unexpected package member",
    );
    const end = offset + 512 + size;
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    requireThat(next <= data.length, "Truncated package member");
    requireThat(
      data.subarray(end, next).every((byte) => byte === 0),
      "Nonzero tar member padding",
    );
    if (!directory)
      files.set(
        name.slice("package/".length),
        data.subarray(offset + 512, end),
      );
    offset = next;
  }
  requireThat(ended, "Missing tar end marker");
  requireThat(
    files.size === allowed.size &&
      [...allowed].every((name) => files.has(name.slice(8))),
    "Missing package member",
  );
  return files;
}

export function verifyPackage(bytes, expectedSha256) {
  requireThat(
    /^[a-f0-9]{64}$/i.test(expectedSha256 ?? ""),
    "Supply the SHA-256 from a trusted private distribution record",
  );
  requireThat(
    digest(bytes) === expectedSha256.toLowerCase(),
    "Archive SHA-256 mismatch",
  );
  const files = readPackage(bytes);
  const json = (name) => JSON.parse(files.get(name).toString("utf8"));
  const manifest = json("package.json"),
    integrity = json("integrity.json");
  requireThat(
    manifest.name === "dsh-baseseer" &&
      typeof manifest.version === "string" &&
      privateVersion.test(manifest.version),
    "Expected private BaseSeer package",
  );
  requireThat(
    manifest.private === true && manifest.license === "SEE LICENSE IN LICENSE",
    "Private distribution policy missing",
  );
  requireThat(
    Object.keys(manifest).every((key) =>
      [
        "name",
        "version",
        "private",
        "license",
        "type",
        "description",
        "main",
        "exports",
        "dsh",
        "engines",
        "peerDependencies",
      ].includes(key),
    ) &&
      !manifest.scripts &&
      !manifest.bin &&
      !manifest.publishConfig &&
      !manifest.dependencies,
    "Unexpected install or publish behavior",
  );
  requireThat(
    manifest.type === "module" &&
      manifest.main === "./dist/host.js" &&
      manifest.engines?.node === ">=24.19.0 <25",
    "Unexpected runtime entry or engine",
  );
  requireThat(
    JSON.stringify(manifest.peerDependencies) ===
      JSON.stringify({ "@deepseek-ai/dsh-tools": "0.2.2-rc.1" }),
    "Unexpected host dependency",
  );
  requireThat(
    JSON.stringify(manifest.exports) ===
      JSON.stringify({
        ".": "./dist/host.js",
        "./client": "./dist/client.js",
        "./package.json": "./package.json",
      }) &&
      JSON.stringify(manifest.dsh) ===
        JSON.stringify({
          bundle: { patch: "./cordis.patch.yml" },
          client: { platform: "web", immediately: true },
        }),
    "Unexpected DSH entry points",
  );
  requireThat(
    integrity.version === manifest.version &&
      integrity.files &&
      Object.keys(integrity.files).length === releaseFiles.length,
    "Integrity inventory mismatch",
  );
  for (const name of releaseFiles)
    requireThat(
      integrity.files[name] === digest(files.get(name)),
      `File integrity mismatch: ${name}`,
    );
  const inventory = json("dependency-inventory.json"),
    provenance = json("build-info.json");
  requireThat(
    inventory.schema === 1 &&
      Array.isArray(inventory.bundled) &&
      inventory.bundled.length > 0,
    "Dependency inventory missing",
  );
  const identities = new Set();
  const notices = files.get("THIRD_PARTY_NOTICES.txt").toString("utf8");
  for (const item of inventory.bundled) {
    const id = `${item.name}@${item.version}`;
    requireThat(
      !identities.has(id) &&
        typeof item.license === "string" &&
        item.license.length > 0,
      "Invalid dependency identity or license",
    );
    identities.add(id);
    requireThat(
      Array.isArray(item.bundles) &&
        item.bundles.length > 0 &&
        item.bundles.every(
          (name) => releaseFiles.includes(name) && name.startsWith("dist/"),
        ),
      "Dependency bundle inventory mismatch",
    );
    requireThat(
      Array.isArray(item.notices) && item.notices.length > 0,
      "Dependency notices missing",
    );
    requireThat(
      notices.includes(`----- ${id} -----\n`),
      `Dependency notice missing: ${id}`,
    );
    for (const notice of item.notices) {
      const all = files.get("THIRD_PARTY_NOTICES.txt");
      requireThat(
        Number.isSafeInteger(notice.offset) &&
          notice.offset >= 0 &&
          Number.isSafeInteger(notice.bytes) &&
          notice.bytes > 0 &&
          notice.offset + notice.bytes <= all.length &&
          digest(all.subarray(notice.offset, notice.offset + notice.bytes)) ===
            notice.sha256,
        "Dependency notice bytes mismatch",
      );
    }
  }
  requireThat(
    provenance.schema === 1 &&
      provenance.version === manifest.version &&
      provenance.channel === "private" &&
      provenance.publicReleaseAuthorized === false &&
      provenance.licenseDecision === "Sustainable-Use-1.0",
    "Release boundary missing",
  );
  requireThat(
    provenance.lockfileSha256?.match(/^[a-f0-9]{64}$/) &&
      provenance.sources &&
      provenance.sources["pnpm-lock.yaml"] === provenance.lockfileSha256 &&
      Object.keys(provenance.sources).length > 0,
    "Build provenance missing",
  );
  for (const [name, hash] of Object.entries(provenance.sources))
    requireThat(
      /^[a-zA-Z0-9_./-]+$/.test(name) &&
        !name
          .split("/")
          .some(
            (part) =>
              !part ||
              part === ".." ||
              part === ".local" ||
              part === "node_modules",
          ) &&
        !name.startsWith("/") &&
        /^[a-f0-9]{64}$/.test(hash),
      "Unsafe build provenance",
    );
  // TypeScript ships once. No generated bundle may carry an inlined copy.
  const compiler = files.get("dist/typescript.cjs").toString("utf8");
  requireThat(
    /\bversionMajorMinor = "\d+\.\d+"/.test(compiler) &&
      inventory.bundled.some(
        (item) =>
          item.name === "typescript" &&
          item.bundles.includes("dist/typescript.cjs"),
      ),
    "Shared TypeScript compiler missing",
  );
  for (const name of releaseFiles.filter(
    (name) => name.startsWith("dist/") && name !== "dist/typescript.cjs",
  ))
    requireThat(
      !files.get(name).toString("utf8").includes("versionMajorMinor = "),
      `Duplicate TypeScript compiler in ${name}`,
    );
  const installed = [...files.values()].reduce((a, b) => a + b.length, 0);
  requireThat(
    installed < 30_000_000,
    "Installed footprint exceeds 30,000,000 bytes",
  );
  return {
    version: manifest.version,
    sha256: digest(bytes),
    fileCount: files.size,
    installedBytes: installed,
    bundledDependencies: identities.size,
    channel: "private",
    publicReleaseAuthorized: false,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [archive, expected] = process.argv.slice(2);
  if (!archive || !expected)
    throw new Error(
      "Usage: node scripts/verify-package.mjs <archive.tgz> <trusted-sha256>",
    );
  requireThat(
    fs.statSync(archive).size <= 32 * 1024 * 1024,
    "Compressed package is too large",
  );
  console.log(
    JSON.stringify(verifyPackage(fs.readFileSync(archive), expected), null, 2),
  );
}

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { sharedNodeBundles, clientBundle } from "./bundle.mjs";
import { fileURLToPath } from "node:url";
import { releaseFiles, privateVersion } from "./release-files.mjs";
import { verifyPackage } from "./verify-package.mjs";
import { checkBoundaries } from "./check-boundaries.mjs";
import { measureFootprint, folderFiles } from "./measure-production.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// The TypeScript compiler ships once, verbatim, as dist/typescript.cjs.
// Every Node bundle lives in dist/ and imports that single copy relatively.
export const TYPESCRIPT_VENDOR = "dist/typescript.cjs";
// Build only allowlisted product files. No source checkout, local settings,
// database, authentication, test endpoints or lifecycle scripts ship by accident.
export async function packagePilot({
  version = "0.1.0-private.1",
  output = path.join(root, ".local/packages"),
} = {}) {
  const boundaries = checkBoundaries(root);
  if (!boundaries.passed)
    throw new Error(
      `Module boundary check failed: ${JSON.stringify([...boundaries.failures, ...boundaries.storage])}`,
    );
  if (!privateVersion.test(version))
    throw new Error("Expected a private pilot version");
  output = path.resolve(output);
  fs.mkdirSync(output, { recursive: true });
  const archive = path.join(output, `dsh-baseseer-${version}.tgz`);
  if (fs.existsSync(archive) || fs.existsSync(archive + ".json"))
    throw new Error(
      "Package version already exists; choose a new private version or a new output directory",
    );
  const staging = fs.mkdtempSync(path.join(output, "stage-"));
  const folder = path.join(staging, "package");
  fs.mkdirSync(path.join(folder, "dist"), { recursive: true });
  const node = await sharedNodeBundles(path.join(folder, "dist"), {
    absWorkingDir: root,
    external: ["@deepseek-ai/dsh-tools"],
    banner: {
      js: 'import { createRequire as __bpCreateRequire } from "node:module"; import { fileURLToPath as __bpFileURLToPath } from "node:url"; import { dirname as __bpDirname } from "node:path"; const require = __bpCreateRequire(import.meta.url); const __filename = __bpFileURLToPath(import.meta.url); const __dirname = __bpDirname(__filename);',
    },
  });
  const client = await clientBundle(path.join(folder, "dist/client.js"), {
    absWorkingDir: root,
  });
  const typescriptSource = path.join(
    root,
    "node_modules/typescript/lib/typescript.js",
  );
  fs.copyFileSync(typescriptSource, path.join(folder, TYPESCRIPT_VENDOR));
  const vendors = { [TYPESCRIPT_VENDOR]: typescriptSource };
  const inputs = [
    ...Object.keys(node.metafile.inputs),
    ...Object.keys(client.metafile.inputs),
  ];
  if (inputs.some((p) => /(^|[/\\])(tests|\.local)([/\\])/.test(p)))
    throw new Error("Test/local files must not ship in the product bundle");
  const manifest = {
    name: "dsh-baseseer",
    version,
    private: true,
    license: "SEE LICENSE IN LICENSE",
    type: "module",
    description:
      "BaseSeer: talk through your app idea, see the plan, and let models build it.",
    main: "./dist/host.js",
    exports: {
      ".": "./dist/host.js",
      "./client": "./dist/client.js",
      "./package.json": "./package.json",
    },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web", immediately: true },
    },
    engines: { node: ">=24.19.0 <25" },
    peerDependencies: { "@deepseek-ai/dsh-tools": "0.2.2-rc.1" },
  };
  fs.writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  for (const name of [
    "cordis.patch.yml",
    "config.profile.example.yml",
    "SECURITY.md",
    "LICENSE",
  ])
    fs.copyFileSync(path.join(root, name), path.join(folder, name));
  for (const name of [
    "UPSTREAM_SOURCES.md",
    "UPSTREAM_NOTICES.txt",
    "upstream-sources.json",
  ])
    fs.copyFileSync(
      path.join(root, "third-party", name),
      path.join(folder, name),
    );
  fs.writeFileSync(
    path.join(folder, "README.md"),
    `# BaseSeer — private candidate ${version}\n\nCandidate package targeting the Windows DSH 0.2.2-rc.1 web profile and Node >=24.19.0 <25. This target does not establish which version is installed in an existing host. No development checkout is required. Install only with the owner's approval through DSH's plugin workflow, preserving saved data, project folders, credential stores and other plugins. This minimal distribution does not include the internal setup, maintenance or support guides; obtain installation guidance through the owner's existing private channel before changing a live installation.\n\nBefore installation, verify the archive against a SHA-256 obtained from a separately trusted private distribution record. Hashes detect corruption; they do not authenticate an unknown sender. The separate archive record supplies the SHA-256 and file inventory. dependency-inventory.json lists bundled packages; build-info.json records source and lockfile hashes.\n\nRead [security](SECURITY.md) before use. Model requests may send selected source and plan context to the configured provider. Builds run ordinary DSH coding agents with DSH's full access in the project folder; BaseSeer does not sandbox hostile programs. Never share credentials, OAuth stores, token-bearing URLs or unreviewed logs.\n\nThis artifact is built for a private distribution channel and does not imply owner acceptance or a public release by the maintainer. BaseSeer's own code is licensed under the standard Sustainable Use License 1.0 in LICENSE. Use and modification are permitted for your own internal business purposes, or for noncommercial or personal use. Distribution or provision to others must be free of charge and for noncommercial purposes. Recipients must receive the license terms; preserve notices and identify modified copies. The license does not require publishing private modifications or providing the complete source of distributed forks. LICENSE controls these permissions regardless of the package's private channel metadata and does not restrict separately licensed dependencies. THIRD_PARTY_NOTICES.txt retains dependency notices; UPSTREAM_SOURCES.md, UPSTREAM_NOTICES.txt and upstream-sources.json retain upstream source and notice information. Review dependency advisories, distribution contents and third-party obligations before wider distribution.\n`,
  );

  // Retain the licenses of every package whose code is included in a bundle.
  const licenses = new Map();
  const inside = (directory, file) => {
    const relative = path.relative(directory, path.resolve(root, file));
    return (
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative)
    );
  };
  const bundles = {
    ...Object.fromEntries(
      Object.entries(node.metafile.outputs).map(([name, output]) => [
        "dist/" + path.basename(name),
        {
          metafile: {
            inputs: Object.fromEntries(
              Object.keys(output.inputs).map((input) => [
                input,
                node.metafile.inputs[input],
              ]),
            ),
            outputs: { [name]: output },
          },
        },
      ]),
    ),
    "dist/client.js": client,
  };
  const vendorInputs = Object.values(vendors).map((file) =>
    path.relative(root, file),
  );
  for (const input of [
    ...new Set(
      [...inputs, ...vendorInputs].filter((p) => p.includes("node_modules")),
    ),
  ].sort()) {
    let directory = path.dirname(path.resolve(root, input));
    while (!fs.existsSync(path.join(directory, "package.json"))) {
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error("Bundled dependency manifest missing");
      directory = parent;
    }
    const pkg = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    const key = `${pkg.name}@${pkg.version}`;
    if (licenses.has(key)) continue;
    const notices = fs
      .readdirSync(directory)
      .filter((name) => /^(license|licence|notice|copyright)(\.|$)/i.test(name))
      .sort();
    if (!notices.length) throw new Error(`Missing bundled license: ${key}`);
    if (typeof pkg.license !== "string" || !pkg.license)
      throw new Error(`Missing declared license: ${key}`);
    licenses.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      packageUrl: `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      bundles: [
        ...Object.entries(bundles)
          .filter(([, result]) =>
            Object.keys(result.metafile.inputs).some((file) =>
              inside(directory, file),
            ),
          )
          .map(([name]) => name),
        ...Object.entries(vendors)
          .filter(([, file]) => inside(directory, file))
          .map(([name]) => name),
      ].sort(),
      notices: notices.map((name) => ({
        name,
        content: fs.readFileSync(path.join(directory, name)),
      })),
    });
  }
  const chunks = [],
    bundled = [];
  let position = 0;
  const append = (bytes) => {
    const b = Buffer.from(bytes);
    chunks.push(b);
    position += b.length;
  };
  for (const [key, item] of [...licenses].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    append(`----- ${key} -----\n`);
    const notices = [];
    for (const notice of item.notices) {
      append(`--- ${notice.name} ---\n`);
      notices.push({
        name: notice.name,
        offset: position,
        bytes: notice.content.length,
        sha256: createHash("sha256").update(notice.content).digest("hex"),
      });
      append(notice.content);
      append("\n\n");
    }
    bundled.push({ ...item, notices });
  }
  fs.writeFileSync(
    path.join(folder, "THIRD_PARTY_NOTICES.txt"),
    Buffer.concat(chunks),
  );
  const externalImports = Object.fromEntries(
    Object.entries(bundles).map(([name, result]) => [
      name,
      [
        ...new Set(
          Object.values(result.metafile.outputs).flatMap((entry) =>
            entry.imports
              .filter((entry) => entry.external)
              .map((entry) => entry.path),
          ),
        ),
      ].sort(),
    ]),
  );
  fs.writeFileSync(
    path.join(folder, "dependency-inventory.json"),
    JSON.stringify(
      {
        schema: 1,
        scope:
          "npm packages observed in bundler inputs; elkjs nested source/notices materials are in upstream-sources.json and UPSTREAM_SOURCES.md",
        bundled,
        externalImports,
      },
      null,
      2,
    ) + "\n",
  );
  const sourceNames = [
    ...new Set([
      ...inputs.filter((name) => !name.includes("node_modules")),
      "scripts/package.mjs",
      "scripts/bundle.mjs",
      "scripts/release-files.mjs",
      "scripts/verify-package.mjs",
      "scripts/package-upstream.mjs",
      "third-party/upstream-sources.json",
      "third-party/UPSTREAM_SOURCES.md",
      "third-party/UPSTREAM_NOTICES.txt",
      "package.json",
      "pnpm-lock.yaml",
      "SECURITY.md",
      "LICENSE",
      "cordis.patch.yml",
      "config.profile.example.yml",
    ]),
  ].sort();
  const sources = Object.fromEntries(
    sourceNames.map((name) => [
      name.replaceAll("\\", "/"),
      sha256(path.resolve(root, name)),
    ]),
  );
  fs.writeFileSync(
    path.join(folder, "build-info.json"),
    JSON.stringify(
      {
        schema: 1,
        version,
        channel: "private",
        publicReleaseAuthorized: false,
        licenseDecision: "Sustainable-Use-1.0",
        node: process.version,
        platform: process.platform,
        lockfileSha256: sha256(path.join(root, "pnpm-lock.yaml")),
        sources,
      },
      null,
      2,
    ) + "\n",
  );
  const members = releaseFiles;
  const hashes = Object.fromEntries(
    members.map((name) => [name, sha256(path.join(folder, name))]),
  );
  fs.writeFileSync(
    path.join(folder, "integrity.json"),
    JSON.stringify({ version, files: hashes }, null, 2) + "\n",
  );
  // The installed package stays strictly under 30,000,000 bytes.
  const footprint = measureFootprint({
    files: folderFiles(folder),
    bundles: Object.fromEntries(
      Object.entries(bundles).map(([name, result]) => [name, result.metafile]),
    ),
    vendors: { [TYPESCRIPT_VENDOR]: "typescript" },
  });
  if (!footprint.passed)
    throw new Error(
      `Installed footprint gate failed: ${footprint.failures.join("; ")}`,
    );
  const builtArchive = path.join(staging, "candidate.tgz");
  execFileSync(
    process.platform === "win32" ? "tar.exe" : "tar",
    ["--format=ustar", "-czf", builtArchive, "-C", staging, "package"],
    { windowsHide: true },
  );
  const report = {
    version,
    archive: path.basename(archive),
    sha256: sha256(builtArchive),
    files: hashes,
    bundledDependencies: [...licenses.keys()].sort(),
    externalPeer: manifest.peerDependencies,
    footprint: {
      rule: footprint.rule,
      installed: footprint.installed,
      headroom: footprint.headroom,
      areas: footprint.areas,
    },
    verification: verifyPackage(
      fs.readFileSync(builtArchive),
      sha256(builtArchive),
    ),
  };
  // Exclusive creation also protects an identity when two builds race.
  fs.copyFileSync(builtArchive, archive, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(archive + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  return { archive, folder, report };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await packagePilot({ version: process.argv[2] });
  // The archive and its report are the release; the staged folder only built them.
  fs.rmSync(path.dirname(result.folder), { recursive: true, force: true });
  console.log(
    JSON.stringify({ archive: result.archive, ...result.report }, null, 2),
  );
}

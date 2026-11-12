import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

// Node entry points resolve the one verbatim compiler beside their bundles.
const sharedTypescript = {
  name: "shared-typescript",
  setup(build) {
    build.onResolve({ filter: /^typescript$/ }, () => ({
      path: "./typescript.cjs",
      external: true,
    }));
  },
};

export const nodeBundle = (entry, outfile, options = {}) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    plugins: [sharedTypescript],
    metafile: true,
    ...options,
  });

export async function sharedNodeBundles(outdir, options = {}) {
  const result = await nodeBundle(undefined, undefined, {
    minifyWhitespace: true,
    ...options,
    entryPoints: {
      host: "src/integrations/dsh/host.ts",
      "analysis-worker": "src/analysis/analysis-worker.ts",
    },
    outdir,
    splitting: true,
    write: false,
  });
  const outputs = result.metafile.outputs;
  const consumers = new Map();
  const visit = (name, entry) => {
    const users = consumers.get(name) ?? new Set();
    if (users.has(entry)) return;
    consumers.set(name, users.add(entry));
    for (const dependency of outputs[name].imports)
      if (!dependency.external) visit(dependency.path, entry);
  };
  for (const [name, output] of Object.entries(outputs))
    if (output.entryPoint) visit(name, path.posix.basename(name, ".js"));
  // Stable names keep the distribution allowlist closed as source hashes change.
  // A new sharing topology requires an explicit release-files edit.
  const names = new Map(
    Object.keys(outputs)
      .filter((name) => !outputs[name].entryPoint)
      .map((name) => [
        name,
        path.posix.join(
          path.posix.dirname(name),
          `shared-${[...consumers.get(name)].sort().join("-")}.js`,
        ),
      ]),
  );
  if (new Set(names.values()).size !== names.size)
    throw new Error("Shared bundle names collide; review the release surface");
  fs.mkdirSync(outdir, { recursive: true });
  const renamed = {};
  for (const file of result.outputFiles) {
    const name = path
      .relative(options.absWorkingDir ?? process.cwd(), file.path)
      .replaceAll("\\", "/");
    let text = file.text;
    for (const [from, to] of names)
      text = text.replaceAll(
        JSON.stringify(`./${path.posix.basename(from)}`),
        JSON.stringify(`./${path.posix.basename(to)}`),
      );
    const output = outputs[name];
    const target = names.get(name) ?? name;
    fs.writeFileSync(
      path.resolve(options.absWorkingDir ?? process.cwd(), target),
      text,
    );
    renamed[target] = {
      ...output,
      bytes: Buffer.byteLength(text),
      imports: output.imports.map((item) => ({
        ...item,
        path: names.get(item.path) ?? item.path,
      })),
    };
  }
  return { metafile: { inputs: result.metafile.inputs, outputs: renamed } };
}

export const clientBundle = (outfile, options = {}) =>
  build({
    entryPoints: ["src/ui/client.tsx"],
    outfile,
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2022",
    minifyWhitespace: true,
    metafile: true,
    loader: { ".css": "text", ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["react", "@deepseek-ai/cordis"],
    banner: {
      js: 'window.__ModuleLoader__.load({id:"dsh-baseseer", factory: function(require) { var module = {exports:{}}; var exports = module.exports;',
    },
    footer: { js: "return module.exports; }});" },
    ...options,
  });

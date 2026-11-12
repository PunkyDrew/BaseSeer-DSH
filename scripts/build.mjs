import { sharedNodeBundles, clientBundle } from "./bundle.mjs";
import fs from "node:fs";
import { checkBoundaries } from "./check-boundaries.mjs";
const boundaries = checkBoundaries();
if (!boundaries.passed)
  throw new Error(
    `Module boundary check failed: ${JSON.stringify(boundaries.failures)}`,
  );
const host = await sharedNodeBundles("dist", {
  packages: "external",
});
fs.copyFileSync(
  "node_modules/typescript/lib/typescript.js",
  "dist/typescript.cjs",
);
if (Object.keys(host.metafile.inputs).some((p) => p.startsWith("tests/")))
  throw new Error("Test fixtures must not ship in the product bundle");
await clientBundle("dist/client.js");

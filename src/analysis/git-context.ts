import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { canonical } from "../domain/records.ts";
import type { CodeSnapshot } from "../contracts/code.ts";

export function gitContext(root: string) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  const read = (...args: string[]) => {
    const r = spawnSync(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 5000 },
    );
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const head = read("rev-parse", "HEAD"),
    branch = read("rev-parse", "--abbrev-ref", "HEAD"),
    tree = read("rev-parse", "HEAD^{tree}");
  return head && branch && tree ? { head, branch, tree } : null;
}
const execute = promisify(execFile);
export async function gitContextAsync(root: string, signal?: AbortSignal) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  const read = async (...args: string[]) => {
    try {
      const pending = execute(
        "git",
        [
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        {
          cwd: root,
          env,
          windowsHide: true,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
          signal,
        },
      );
      // execFile rejects on abort before the child necessarily closes. Keep
      // scan cancellation pending until the process releases its cwd/handles.
      const closed = new Promise<void>((resolve) =>
        pending.child.once("close", () => resolve()),
      );
      try {
        const result = await pending;
        return result.stdout.trim();
      } finally {
        await closed;
      }
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  };
  // Sequential reads keep the Git process count bounded per inspection.
  const head = await read("rev-parse", "HEAD"),
    branch = await read("rev-parse", "--abbrev-ref", "HEAD"),
    tree = await read("rev-parse", "HEAD^{tree}");
  return head && branch && tree ? { head, branch, tree } : null;
}
export function observationDigest(code: CodeSnapshot) {
  if (code.analysis)
    return createHash("sha256")
      .update(
        canonical({
          files: code.digest,
          git: code.git,
          analysis: code.analysis.fingerprint,
        }),
      )
      .digest("hex");
  return code.git
    ? createHash("sha256")
        .update(canonical({ files: code.digest, git: code.git }))
        .digest("hex")
    : code.digest;
}

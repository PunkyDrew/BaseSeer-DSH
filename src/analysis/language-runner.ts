import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { createHash } from "node:crypto";
import {
  analysisLimits,
  analysisVersion,
  type AnalysisInput,
  type AnalysisOutput,
} from "./language-types.ts";
import type { AnalysisReport } from "../contracts/language-analysis.ts";
import { emptyAnalysis } from "./language-facts.ts";
import { webSource, webToolVersion } from "./web-language.ts";
import {
  packageJsonSource,
  packageJsonToolVersion,
} from "./package-json-language.ts";
import {
  validateLanguageAnalysis,
  validateAnalysisReport,
} from "../contracts/language-validation.ts";

/** The adapter reported for a source that receives an "unavailable" analysis when the worker fails. */
function failureAdapter(file: string) {
  if (packageJsonSource.test(file)) return "package-json";
  if (webSource.test(file)) return "web-assets";
  return /\.[cm]?[jt]sx?$/i.test(file) ? "typescript" : undefined;
}

const worker = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts")
      ? "./analysis-worker.ts"
      : "./analysis-worker.js",
    import.meta.url,
  ),
);
const args = ["--max-old-space-size=256", "--stack-size=768", worker];
const environment = () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
};
// Repeated Code/Review/activity reads reuse only exact source/config/tool identities.
// No source text is cached; returned facts are cloned so consumers cannot mutate receipts.
const cache = new Map<string, string>();
let cacheBytes = 0;
export function cacheIdentity(value: AnalysisInput) {
  return JSON.stringify({
    version: analysisVersion,
    ts: ts.version,
    web: value.files.some((f) => webSource.test(f.path))
      ? webToolVersion
      : null,
    packageJson: value.files.some((f) => packageJsonSource.test(f.path))
      ? packageJsonToolVersion
      : null,
    files: value.files.map((f) => [f.path, f.sha256]),
    configuration: value.configuration,
  });
}
function cacheKey(value: AnalysisInput) {
  return createHash("sha256").update(cacheIdentity(value)).digest("hex");
}
function remember(key: string, result: AnalysisOutput) {
  const json = JSON.stringify(result),
    bytes = Buffer.byteLength(json);
  if (bytes > 4 * 1024 * 1024) return result;
  if (cache.has(key)) {
    cacheBytes -= Buffer.byteLength(cache.get(key)!);
    cache.delete(key);
  }
  while (cache.size >= 64 || cacheBytes + bytes > 8 * 1024 * 1024) {
    const old = cache.keys().next().value!;
    cacheBytes -= Buffer.byteLength(cache.get(old)!);
    cache.delete(old);
  }
  cache.set(key, json);
  cacheBytes += bytes;
  return result;
}
function failed(value: AnalysisInput, reason: string): AnalysisOutput {
  const fingerprint = createHash("sha256")
    .update(analysisVersion + reason)
    .digest("hex");
  const files = value.files.map(({ content: _content, ...f }) => {
    const adapter = failureAdapter(f.path);
    if (adapter)
      f.analysis = emptyAnalysis(
        f,
        adapter,
        "Analysis worker",
        "unavailable",
        fingerprint,
        "unavailable",
        reason,
      );
    return f;
  });
  return {
    files,
    analysis: {
      version: 1,
      fingerprint,
      configuration: [],
      adapters: [],
      gaps: [reason],
      elapsedMs: 0,
    },
  };
}
function decode(value: AnalysisInput, output: string): AnalysisOutput {
  const result = JSON.parse(output) as AnalysisOutput;
  if (result.files.length !== value.files.length)
    throw Error("Invalid analysis inventory");
  for (let i = 0; i < result.files.length; i++) {
    const file = result.files[i];
    if (
      file.path !== value.files[i].path ||
      file.sha256 !== value.files[i].sha256
    )
      throw Error("Invalid analysis source identity");
    if (file.analysis)
      validateLanguageAnalysis(file.analysis, file, result.files);
  }
  validateAnalysisReport(result.analysis, result.files);
  return result;
}
export function analyzeSync(data: AnalysisInput): AnalysisOutput {
  const key = cacheKey(data),
    cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const result = spawnSync(process.execPath, args, {
    input: JSON.stringify(data),
    encoding: "utf8",
    cwd: path.dirname(process.execPath),
    env: environment(),
    windowsHide: true,
    timeout: analysisLimits.timeoutMs,
    maxBuffer: analysisLimits.outputBytes,
  });
  try {
    if (result.status === 0) return remember(key, decode(data, result.stdout));
  } catch {
    /* Invalid facts cannot enter storage. */
  }
  return failed(
    data,
    "Analysis worker failed, timed out or exceeded its resource/output limit; narrow the scan scope and refresh.",
  );
}
let activeWorkers = 0;
const waiting: (() => void)[] = [];
const inFlight = new Map<string, Promise<AnalysisOutput>>();
function queued<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal!.reason);
    };
    const start = () => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason);
        waiting.shift()?.();
        return;
      }
      activeWorkers++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeWorkers--;
          waiting.shift()?.();
        });
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (activeWorkers < 2) start();
    else waiting.push(start);
  });
}
export function analyze(
  data: AnalysisInput,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AnalysisOutput> {
  options.signal?.throwIfAborted();
  const key = cacheKey(data);
  // Sharing is only for simultaneous requests.
  const shared = !options.signal && options.timeoutMs === undefined;
  const existing = shared && inFlight.get(key);
  if (existing) return existing.then((result) => structuredClone(result));
  if (waiting.length >= 16)
    return Promise.resolve(
      failed(
        data,
        "Analysis queue is full; retry after active inspections finish.",
      ),
    );
  const result = queued(async () => {
    const cached = options.timeoutMs === undefined && cache.get(key);
    if (cached) return JSON.parse(cached);
    const output = await workerOutput(data, options);
    try {
      if (output !== undefined) return remember(key, decode(data, output));
    } catch {
      /* Invalid facts cannot enter storage. */
    }
    return failed(
      data,
      "Analysis worker failed, timed out or exceeded its resource/output limit; narrow the scan scope and refresh.",
    );
  }, options.signal);
  if (shared) {
    inFlight.set(key, result);
    result.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    );
  }
  return result.then((value) => structuredClone(value));
}
function workerOutput(
  data: AnalysisInput,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | undefined> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(process.execPath),
      env: environment(),
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      size = 0,
      stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid && process.platform === "win32")
        spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          timeout: 3000,
          stdio: "ignore",
        }).on("error", () => child.kill("SIGKILL"));
      else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const timer = setTimeout(
      stop,
      Math.min(
        options.timeoutMs ?? analysisLimits.timeoutMs,
        analysisLimits.timeoutMs,
      ),
    );
    const abort = () => stop();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      size += Buffer.byteLength(part);
      if (size > analysisLimits.outputBytes) stop();
      else output += part;
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      resolve(!stopped && code === 0 ? output : undefined);
    });
    child.stdin.end(JSON.stringify(data));
  });
}
/** Whether saved facts came from the analyzers this version runs, at the versions it runs them. */
export function analysisToolsCurrent(report?: AnalysisReport) {
  if (!report) return true; // Legacy observations keep their original labels.
  return report.adapters.every((a) => {
    if (a.version !== "1") return false;
    if (a.id === "typescript") return a.toolVersion === ts.version;
    if (a.id === "web-assets") return a.toolVersion === webToolVersion;
    if (a.id === "package-json")
      return a.toolVersion === packageJsonToolVersion;
    return false;
  });
}

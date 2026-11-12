import { createHash, randomUUID } from "node:crypto";
import {
  apiEquivalentRate,
  modelTokens,
  type ModelUsage,
} from "../../domain/model-usage.ts";
import type { ProjectUsage } from "../../storage/project-local.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function modelUsageObserver(
  ctx: any,
  storage: ProjectUsage,
  actors: Map<string, any>,
  clock = Date.now,
  /** Attribution for a build: its lead and the sessions it starts. */
  attribution?: { get(session: string): any },
) {
  let active = true;
  const release = ctx.on(
    "llm/stream",
    async function* (options: any, next: () => AsyncIterable<any>) {
      const actor =
        actors.get(options.sessionId) ?? attribution?.get(options.sessionId);
      if (!active || !actor || !["planner", "worker"].includes(actor.role)) {
        yield* next();
        return;
      }
      const started = clock();
      // Only lengths and one-way prompt/tool-prefix hashes leave this hook. No
      // prompt text, response text, replay metadata, endpoint or credential is saved.
      const prefix = JSON.stringify({
        system: options.system,
        messages: (options.messages ?? []).filter(
          (m: any) => m.role === "system",
        ),
        tools: options.tools,
      });
      const run = actor.usage?.run;
      const row: ModelUsage = {
        id: randomUUID(),
        plan: actor.plan,
        session: options.sessionId,
        stage: run ? "build" : "planning",
        ...(run ? { run } : {}),
        ...(["compaction", "session-title"].includes(options.purpose)
          ? { purpose: options.purpose }
          : {}),
        provider: options.provider,
        model: options.model,
        started,
        outcome: "started",
        prefixSha256: sha(prefix),
        prefixChars: prefix.length,
        requestChars: JSON.stringify({
          system: options.system,
          messages: options.messages ?? [],
          tools: options.tools,
        }).length,
        tokens: null,
        rate: apiEquivalentRate(options.model, started),
      };
      storage.save(row);
      try {
        for await (const chunk of next()) {
          if (chunk.type === "usage") {
            const tokens = modelTokens(chunk.usage);
            if (row.tokens !== null || row.invalidUsage || !tokens) {
              row.tokens = null;
              row.invalidUsage = true;
            } else row.tokens = tokens;
            // Retain known usage even if the host stops before terminal finish.
            if (active) storage.save(row);
          }
          if (chunk.type === "finish")
            row.outcome = ["error", "aborted"].includes(chunk.reason?.kind)
              ? chunk.reason.kind
              : "finished";
          yield chunk;
        }
      } catch (error) {
        row.outcome = options.signal?.aborted ? "aborted" : "error";
        throw error;
      } finally {
        if (row.outcome === "started") row.outcome = "interrupted";
        row.ended = clock();
        if (active) storage.save(row);
      }
    },
    { global: true },
  );
  return () => {
    active = false;
    release?.();
  };
}

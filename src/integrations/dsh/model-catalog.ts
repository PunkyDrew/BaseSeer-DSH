import { modelThinking } from "../../domain/model-thinking.ts";

// Read every registered provider. One broken model must not hide its siblings.
// Return only allowlisted metadata; provider failures can contain credentials.
export async function discoverWorkModels(llm: any) {
  const models: any[] = [],
    issues: any[] = [];
  for (const provider of llm.listProviders()) {
    const id = provider.id ?? provider.provider;
    let entries;
    try {
      entries = await llm.listModels(id);
    } catch {
      issues.push({
        provider: id,
        stage: "list",
        message:
          "Provider catalog could not be read; credentials or quota are not established.",
      });
      continue;
    }
    // Bound metadata requests per provider. Store by catalog position so slow
    // or failed resolutions cannot reorder models or diagnostic messages.
    const resolved: { model: any; issue?: any }[] = new Array(entries.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (next < entries.length) {
          const index = next++,
            model = entries[index];
          try {
            const info = await llm.resolveModelInfo(id, model.id);
            const thinking = modelThinking(info);
            resolved[index] = {
              model: {
                provider: id,
                id: model.id,
                name: model.name,
                description: info.description,
                inputModalities: info.inputModalities,
                reasoning: info.reasoning,
                thinkingChoices: thinking.options.map((o) => o.id),
                thinkingOptions: thinking.options,
                defaultThinking: thinking.defaultChoice || null,
                metadata: "resolved",
                configuration:
                  "registered adapter; credentials, quota and tool execution are not proven by listing",
                context: info.context,
                defaultMaxTokens: info.defaultMaxTokens,
                economics: {
                  status: "unknown",
                  note: "No verified account billing, remaining quota, task cost or latency from this catalog.",
                },
              },
            };
          } catch {
            resolved[index] = {
              model: {
                provider: id,
                id: model.id,
                name: model.name,
                metadata: "unresolved",
                thinkingChoices: [],
                configuration:
                  "Listed only; metadata resolution failed. Not dispatchable until resolved.",
              },
              issue: {
                provider: id,
                model: model.id,
                stage: "resolve",
                message:
                  "Model metadata could not be resolved; other models remain visible.",
              },
            };
          }
        }
      }),
    );
    for (const result of resolved) {
      models.push(result.model);
      if (result.issue) issues.push(result.issue);
    }
  }
  return {
    models,
    discovery: {
      observedAt: new Date().toISOString(),
      complete: issues.length === 0,
      issues,
    },
  };
}

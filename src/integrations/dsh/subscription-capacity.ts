// Optional read-only adapter. No credential-store reads, account changes,
// provider list assumptions, network URL configuration or automatic failover.
export async function readSubscriptionCapacity(
  connection: any,
  providers: string[],
  force = false,
) {
  const unavailable = {
    retrievedAt: new Date().toISOString(),
    source: "dsh-plugin-subscriptions",
    status: "unavailable",
    providers: [],
  };
  if (!connection?.createSharedFetchHandler) return unavailable;
  const handler = connection.createSharedFetchHandler("/api");
  const signal = AbortSignal.timeout(6000);
  async function call(endpoint: "status" | "usage", payload: unknown) {
    const method = `subscriptions-auth.${endpoint}`;
    // Read owner-only subscription status as the host's browser peer, in process;
    // this URL is never fetched over a network.
    const response = await handler.fetch(
      new Request(`https://build-plan.invalid/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: crypto.randomUUID(),
          method,
          payload,
        }),
        signal,
      }),
      connection.browserPeer,
    );
    if (!response.ok) throw Error("Usage unavailable");
    const result = (await response.json()).result;
    if (!result?.ok) throw Error("Usage unavailable");
    return result.value;
  }
  let status;
  try {
    status = await call("status", {});
  } catch {
    return unavailable;
  }
  const snapshots = await Promise.all(
    providers.map(async (provider) => {
      const accounts = status.providers?.[provider]?.accounts;
      const account = Array.isArray(accounts)
        ? accounts.find((a: any) => a.isDefault)
        : undefined;
      if (!account)
        return {
          provider,
          status: "unknown",
          subscription: !!status.providers?.[provider],
          windows: [],
        };
      try {
        const usage = await call("usage", {
          provider,
          account: account.key,
          force,
        });
        const windows = (Array.isArray(usage.windows) ? usage.windows : [])
          .filter(
            (w: any) =>
              typeof w.usedPercent === "number" &&
              Number.isFinite(w.usedPercent) &&
              w.usedPercent >= 0 &&
              w.usedPercent <= 100,
          )
          .map((w: any) => ({
            kind: ["session", "weekly", "other"].includes(w.kind)
              ? w.kind
              : "other",
            ...(typeof w.scope === "string"
              ? { scope: w.scope.slice(0, 200) }
              : {}),
            remainingPercent: 100 - w.usedPercent,
            ...(Number.isFinite(w.resetsAt) ? { resetsAt: w.resetsAt } : {}),
          }));
        return {
          provider,
          subscription: true,
          status: usage.supported && windows.length ? "reported" : "unknown",
          ...(typeof usage.plan === "string" && usage.plan.trim()
            ? { plan: usage.plan.slice(0, 200), planSource: "usage-endpoint" }
            : typeof account.plan === "string" && account.plan.trim()
              ? {
                  plan: account.plan.slice(0, 200),
                  planSource: "subscription-status",
                }
              : {}),
          freshCheck: force,
          windows,
        };
      } catch {
        return {
          provider,
          status: "unknown",
          subscription: true,
          windows: [],
          ...(typeof account.plan === "string" && account.plan.trim()
            ? {
                plan: account.plan.slice(0, 200),
                planSource: "subscription-status",
              }
            : {}),
        };
      }
    }),
  );
  return {
    retrievedAt: new Date().toISOString(),
    source: "dsh-plugin-subscriptions",
    status: "available",
    scope:
      "Default accounts only; no account identities or quotas are combined. Unknown providers, scopes and failed lookups stay unknown. Upstream data may be cached; retrieval time is not measurement time. Percentages across providers are not equivalent amounts of work.",
    providers: snapshots,
  };
}
